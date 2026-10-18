// Marketing P2 — A/B winner-picker scheduler tick.
//
// Every AB_WINNER_TICK_MS the tick scans for campaigns that are ready to
// have their winner auto-promoted, then, per-campaign, checks two thresholds:
//
//   1. Effect size: leader's open-rate must be ≥ 20% RELATIVELY higher than
//      the runner-up (i.e. leader.rate >= runnerUp.rate * 1.20). Empirical
//      guardrail so we don't promote a 0.1% edge just because it hit
//      statistical significance from a huge sample.
//   2. Statistical significance: two-proportion z-test at p < 0.05.
//
// Only when BOTH pass do we mark leader.isWinner=true. The route in
// crm-service's materializeRecipients already short-circuits new recipients
// to the winner (via pickVariantForRecipient), so future sends flow to the
// leader automatically.
//
// Opt-in via AB_WINNER_ENABLE=1 — off by default so nobody flips winner
// state on a running production campaign until they've reviewed the logic.

import { prisma, twoProportionZTest, withCrossTenant } from "@lumaara/db";
import { getLogger } from "@lumaara/service-auth";

const log = getLogger("scheduler").child({ component: "ab-winner" });

// Minimum total sends across ALL variants of a campaign before we're willing
// to pick. Default 500 = enough sample for a moderately-sized A/B (100 per
// arm at 5 arms, or 250 per arm at 2 arms). Overridable per environment.
function minSends(): number {
  return Number(process.env.AB_WINNER_MIN_SENDS ?? 500);
}

// Minimum campaign lifetime before we're willing to promote. Some campaigns
// look decisive in the first 10 minutes because of an unlucky sample; we
// want at least 2 hours of engagement data to smooth over the initial
// deliverability spike.
function minAgeMs(): number {
  return Number(process.env.AB_WINNER_MIN_AGE_MS ?? 2 * 60 * 60 * 1000);
}

// Relative effect size gate — leader must be ≥ 1.20× the runner-up. This is
// the "practical significance" filter that complements the p<0.05 statistical
// test. Configurable so an operator can loosen it for very high-volume
// campaigns where even small deltas are meaningful.
function minRelativeLift(): number {
  return Number(process.env.AB_WINNER_MIN_RELATIVE_LIFT ?? 1.2);
}

// Metric used to rank variants. Open-rate is the default because it's a
// weaker signal but arrives sooner; click-rate is available for
// conversion-optimising senders.
function metric(): "open" | "click" {
  return process.env.AB_WINNER_METRIC === "click" ? "click" : "open";
}

export interface AbWinnerTickResult {
  scanned: number;
  promoted: number;
  skipped: number;
  errors: number;
}

export async function runAbWinnerTick(): Promise<AbWinnerTickResult> {
  const result: AbWinnerTickResult = {
    scanned: 0,
    promoted: 0,
    skipped: 0,
    errors: 0,
  };
  if (process.env.AB_WINNER_ENABLE !== "1") {
    return result;
  }

  const cutoff = new Date(Date.now() - minAgeMs());
  // Cross-tenant scan — the scheduler runs system-wide. We only need id +
  // tenantId here; per-campaign work loads the variants scoped to the
  // tenant it belongs to.
  const candidates = await prisma.campaign.findMany(
    withCrossTenant({
      where: {
        // status normalises to Sending; also accept legacy Active for
        // backward compat with rows written before the state-machine upgrade.
        status: { in: ["Sending", "Active"] },
        // Only campaigns that have been running long enough for the sample
        // to stabilise. Falls back to createdAt when sentAt isn't populated
        // yet — some Draft→Sending paths defer sentAt until the first send.
        OR: [
          { sentAt: { lte: cutoff } },
          { AND: [{ sentAt: null }, { createdAt: { lte: cutoff } }] },
        ],
      },
      select: { id: true, tenantId: true, name: true, sentAt: true, createdAt: true },
    }),
  );

  const activeMetric = metric();
  const minSendsThreshold = minSends();
  const liftThreshold = minRelativeLift();

  for (const c of candidates) {
    result.scanned += 1;
    try {
      const variants = await prisma.campaignVariant.findMany({
        where: { tenantId: c.tenantId, campaignId: c.id },
      });
      if (variants.length < 2) {
        result.skipped += 1;
        continue;
      }
      // A winner already exists — nothing to do.
      if (variants.some((v) => v.isWinner)) {
        result.skipped += 1;
        continue;
      }
      const totalSent = variants.reduce((s, v) => s + v.totalSent, 0);
      if (totalSent < minSendsThreshold) {
        result.skipped += 1;
        continue;
      }
      // Rank by metric-rate; require at least 2 variants with real data.
      const withRates = variants
        .filter((v) => v.totalSent > 0)
        .map((v) => ({
          v,
          rate:
            activeMetric === "click"
              ? v.totalClicked / v.totalSent
              : v.totalOpened / v.totalSent,
          successes: activeMetric === "click" ? v.totalClicked : v.totalOpened,
        }))
        .sort((a, b) => b.rate - a.rate);
      if (withRates.length < 2) {
        result.skipped += 1;
        continue;
      }
      const leader = withRates[0]!;
      const runnerUp = withRates[1]!;
      // Effect-size gate: leader.rate must be ≥ liftThreshold × runnerUp.rate.
      // When runnerUp.rate === 0 we treat leader as trivially better only if
      // its own rate is meaningful (> 0), else skip — division by zero would
      // otherwise auto-promote.
      const lift = runnerUp.rate === 0 ? Infinity : leader.rate / runnerUp.rate;
      if (!(lift >= liftThreshold)) {
        result.skipped += 1;
        continue;
      }
      // Statistical gate: p<0.05 two-proportion z-test.
      const sig = twoProportionZTest(
        leader.successes,
        leader.v.totalSent,
        runnerUp.successes,
        runnerUp.v.totalSent,
      );
      if (!sig.isSignificant) {
        result.skipped += 1;
        continue;
      }
      // Promote. Two writes in a transaction so we can never see two winners.
      await prisma.$transaction([
        prisma.campaignVariant.updateMany({
          where: { tenantId: c.tenantId, campaignId: c.id, isWinner: true, NOT: { id: leader.v.id } },
          data: { isWinner: false },
        }),
        prisma.campaignVariant.update({
          where: { id: leader.v.id },
          data: { isWinner: true },
        }),
      ]);
      result.promoted += 1;
      log.info("ab-winner promoted", {
        tenantId: c.tenantId,
        campaignId: c.id,
        campaignName: c.name,
        winnerKey: leader.v.variantKey,
        metric: activeMetric,
        leaderRate: leader.rate,
        runnerUpRate: runnerUp.rate,
        lift,
        pValue: sig.pValue,
        z: sig.z,
      });
    } catch (e) {
      result.errors += 1;
      log.warn("ab-winner failed for campaign", {
        campaignId: c.id,
        err: e instanceof Error ? e : new Error(String(e)),
      });
    }
  }

  return result;
}
