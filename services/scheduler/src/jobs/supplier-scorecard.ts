// Module 46 — Supplier scorecard weekly recompute.
//
// Walks every isActive scorecard across every tenant, recomputes the
// last-complete-period score, upserts the period row + cached latest
// fields. Cross-tenant scan (like other buying/GL ticks) because
// scorecards live per-tenant but the schedule is global.
//
// Idempotent per (scorecard, period): re-running today with the same
// window results in an upsert on the SupplierScorecardPeriod row (its
// @@unique on (scorecardId, fromDate, toDate)). Safe to fire multiple
// times on the same day.

import { prisma, recomputeScorecard, withCrossTenant } from "@lumaara/db";

export interface SupplierScorecardTickResult {
  scorecardsChecked: number;
  scorecardsScored: number;
  errors: number;
}

// Returns the last COMPLETE calendar month or quarter window based on
// the scorecard's `period` setting. Mirrors the resolveWindow helper
// in the route file but keeps this tick self-contained.
function lastCompleteWindow(period: string, now: Date): { fromDate: Date; toDate: Date } {
  if (period === "Quarterly") {
    const q = Math.floor(now.getMonth() / 3);
    const startMonth = q === 0 ? 9 : (q - 1) * 3;
    const startYear = q === 0 ? now.getFullYear() - 1 : now.getFullYear();
    return {
      fromDate: new Date(startYear, startMonth, 1),
      toDate: new Date(startYear, startMonth + 3, 0, 23, 59, 59),
    };
  }
  return {
    fromDate: new Date(now.getFullYear(), now.getMonth() - 1, 1),
    toDate: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59),
  };
}

const MAX_PER_TICK = 50; // cap so one tick doesn't hog the scheduler

export async function runSupplierScorecardTick(now: Date = new Date()): Promise<SupplierScorecardTickResult> {
  const scorecards = await prisma.supplierScorecard.findMany({
    ...withCrossTenant({
      where: { isActive: true },
      take: MAX_PER_TICK,
      // Oldest computed-first so we always cycle through everything
      // rather than getting stuck re-scoring the same handful.
      // NULLS FIRST — never-scored scorecards should score first.
      orderBy: { latestScoredAsOf: { sort: "asc" as const, nulls: "first" as const } },
    }),
    include: { criteria: true },
  });

  let scored = 0;
  let errors = 0;
  for (const sc of scorecards) {
    const window = lastCompleteWindow(sc.period, now);
    try {
      await recomputeScorecard(prisma, sc, window.fromDate, window.toDate);
      scored += 1;
    } catch {
      // Log-and-continue: one bad supplier shouldn't block the tick.
      errors += 1;
    }
  }
  return {
    scorecardsChecked: scorecards.length,
    scorecardsScored: scored,
    errors,
  };
}
