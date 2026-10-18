import type { CampaignVariant } from "@prisma/client";
import { createHash } from "node:crypto";

// Marketing P2 — A/B test variant helpers.
//
// pickVariantForRecipient(): deterministically assign a recipient to one of
// several CampaignVariants based on their weightPercent. The assignment is
// stable: the same recipient id always maps to the same variant for a given
// set of variants+weights, so re-running the materializer never shuffles
// recipients between variants. Callers pass the freshly-loaded variant array
// (already filtered to a single campaign) and the recipient identifier.
//
// Winner-promotion semantics (see scheduler/src/jobs/ab-winner.ts):
//   - If ANY variant has isWinner=true, that variant wins outright — new
//     recipients materialized after the winner is picked all get the winner.
//     Existing recipients that were previously assigned to a losing variant
//     keep that variantId (their send has usually already happened).
//   - Otherwise, we bucket by weight: build a cumulative 0..100 range from
//     the variants in a stable order (by variantKey), hash the recipient id
//     into a 0..99 int, and pick the first bucket whose cumulative threshold
//     is > hashedInt.
//
// Deterministic hash: sha256 → first 4 bytes as uint32 → modulo 100. Simple,
// stable across processes/versions, cryptographically balanced enough for
// distribution purposes.

/**
 * Weighted deterministic assignment. Returns:
 *   - null when `variants` is empty (no A/B test on this campaign)
 *   - the winner variant when any variant has `isWinner=true`
 *   - the variant whose cumulative weight window contains `hash(recipientId) % 100`
 *
 * Weights are used as-is (not renormalised): callers are expected to enforce
 * sum(weightPercent) === 100 at write time (see POST /campaigns/:id/variants).
 * If a caller passes an under-100 weight sum, the LAST variant in variantKey
 * order absorbs the residue — this matches most operators' mental model
 * ("A gets 50, B gets 50, if someone typed 40/50 the remaining 10 goes to B").
 */
export function pickVariantForRecipient(
  variants: CampaignVariant[],
  recipientId: string,
): CampaignVariant | null {
  if (!variants || variants.length === 0) return null;

  // Winner-first: once promoted, ALL new recipients go to the winner. This
  // preserves the "post-winner cohort" property described in the P2 plan.
  const winner = variants.find((v) => v.isWinner);
  if (winner) return winner;

  // Stable order — sorting by variantKey ("A"/"B"/"C") means the same set of
  // variants always produces the same cumulative buckets. We copy to avoid
  // mutating the caller's array.
  const sorted = [...variants].sort((a, b) =>
    a.variantKey.localeCompare(b.variantKey),
  );

  const bucket = hashToBucket(recipientId);
  let cumulative = 0;
  for (const v of sorted) {
    cumulative += Math.max(0, v.weightPercent | 0);
    if (bucket < cumulative) return v;
  }
  // Residue-absorption: if weights sum to <100 the loop exits without a hit
  // for the tail range — hand it to the last (highest key) variant so we
  // never return null when there's at least one variant present.
  return sorted[sorted.length - 1]!;
}

/**
 * Deterministic 0..99 bucket for an arbitrary id.
 *
 * Exported so tests can exercise the distribution independent of the
 * variant-selection logic.
 */
export function hashToBucket(id: string): number {
  const digest = createHash("sha256").update(id).digest();
  const n = digest.readUInt32BE(0);
  return n % 100;
}

/**
 * Merge a variant's overrides onto a campaign's defaults. Any variant field
 * that is null/undefined falls through to the campaign field. Used by the
 * send pipeline (both the immediate /send and any future SMTP-real path)
 * so the outbound EmailMessage carries the right subject/body/from.
 */
export interface CampaignSendDefaults {
  subject: string | null;
  bodyHtml: string | null;
  fromEmail: string | null;
  fromName: string | null;
}
export interface VariantOverrides {
  subject?: string | null;
  bodyHtml?: string | null;
  fromEmail?: string | null;
  fromName?: string | null;
}
export function mergeVariantOverride(
  campaign: CampaignSendDefaults,
  variant: VariantOverrides | null | undefined,
): CampaignSendDefaults {
  if (!variant) return { ...campaign };
  return {
    subject: variant.subject ?? campaign.subject,
    bodyHtml: variant.bodyHtml ?? campaign.bodyHtml,
    fromEmail: variant.fromEmail ?? campaign.fromEmail,
    fromName: variant.fromName ?? campaign.fromName,
  };
}

// ---------- Statistical significance (chi-square / two-proportion z-test) --

// A/B winner-picker uses a two-proportion z-test (normal approximation to
// the difference-of-proportions distribution). This is the standard test
// email-marketing tools use for open/click rate comparisons — it's simpler
// than a full chi-square and equivalent for the 2-variant case we care about.
//
// Formula (pooled variance):
//   p_hat = (x1 + x2) / (n1 + n2)
//   se    = sqrt(p_hat * (1 - p_hat) * (1/n1 + 1/n2))
//   z     = (p1 - p2) / se
//   p     = 2 * (1 - Φ(|z|))   (two-tailed)
//
// We report `isSignificant` at the p<0.05 threshold — |z| >= 1.96.

export interface SignificanceResult {
  z: number;
  pValue: number;
  isSignificant: boolean; // p < 0.05
}

/**
 * Two-proportion z-test.
 * @param x1 successes for group 1 (e.g. opens)
 * @param n1 sample size for group 1 (e.g. sent)
 * @param x2 successes for group 2
 * @param n2 sample size for group 2
 */
export function twoProportionZTest(
  x1: number,
  n1: number,
  x2: number,
  n2: number,
): SignificanceResult {
  if (n1 <= 0 || n2 <= 0) return { z: 0, pValue: 1, isSignificant: false };
  const p1 = x1 / n1;
  const p2 = x2 / n2;
  const pHat = (x1 + x2) / (n1 + n2);
  const varTerm = pHat * (1 - pHat) * (1 / n1 + 1 / n2);
  if (varTerm <= 0) return { z: 0, pValue: 1, isSignificant: false };
  const se = Math.sqrt(varTerm);
  const z = (p1 - p2) / se;
  const pValue = 2 * (1 - standardNormalCdf(Math.abs(z)));
  return { z, pValue, isSignificant: pValue < 0.05 };
}

/**
 * Standard normal CDF via Abramowitz & Stegun 26.2.17 — good to ~7 decimal
 * places, no external dep. Used only by twoProportionZTest.
 */
export function standardNormalCdf(x: number): number {
  // erf approximation, then Φ(x) = 0.5 * (1 + erf(x / √2))
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.SQRT2;
  // Abramowitz & Stegun 7.1.26
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}
