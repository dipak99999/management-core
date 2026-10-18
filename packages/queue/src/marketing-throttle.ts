// Marketing P1 — per-tenant token-bucket rate limiter for outbound email.
//
// Prevents ISP blocks by capping sends/minute per tenant (from
// `Campaign.rateLimitPerMin`). The processor checks a token before dispatching
// each message; a `false` return means "defer this message, break the batch,
// try again next tick".
//
// Implementation choice — in-memory Map per process:
//   * Single-process-per-service is our current deploy shape (auth-service is
//     one node; the scheduler pings its /emails/process endpoint on a cron).
//   * When we scale horizontally, swap this out for a Redis INCR+EXPIRE bucket
//     using the same signature (`takeToken(tenantId, ratePerMin)`) so no
//     callers need to change.
//   * We deliberately don't bring in BullMQ's per-key rate limiter here because
//     the send loop is not yet BullMQ-driven — it's a Prisma poll. Wrapping
//     that in a queue would be a bigger change than P1 warrants.
//
// Refill semantics:
//   * Full refill at each minute boundary (Date.getMinutes() rollover), NOT a
//     leaky-bucket drip. This matches how listmonk + most transactional APIs
//     document their limits ("100 emails per minute" means "up to 100 per
//     wall-clock minute").
//   * The bucket key is `tenantId` — the plan calls out per-tenant throttling.
//     If we later need per-campaign limits, extend the key to
//     `${tenantId}:${campaignId}` at the call site.

interface Bucket {
  tokens: number;
  resetAt: number; // ms epoch — next minute boundary
}

const buckets = new Map<string, Bucket>();

function nextMinuteBoundary(nowMs: number): number {
  const nowSec = Math.floor(nowMs / 1000);
  const boundarySec = Math.ceil((nowSec + 1) / 60) * 60;
  return boundarySec * 1000;
}

/**
 * Attempt to reserve one send. Returns `true` when the caller may proceed,
 * `false` when the tenant is over-budget for the current minute.
 *
 * `ratePerMin <= 0` is treated as "unlimited" (safety valve — the caller
 * should really pass `null` and skip the check, but we tolerate 0/negative
 * to avoid crashing the send loop on bad campaign data).
 */
export async function takeToken(
  tenantId: string,
  ratePerMin: number,
): Promise<boolean> {
  if (!tenantId || ratePerMin <= 0 || !Number.isFinite(ratePerMin)) return true;

  const now = Date.now();
  let b = buckets.get(tenantId);
  if (!b || now >= b.resetAt) {
    b = { tokens: ratePerMin, resetAt: nextMinuteBoundary(now) };
    buckets.set(tenantId, b);
  }
  // If the caller raised the campaign's limit between minutes, don't shrink
  // it mid-window — just top up.
  if (b.tokens > ratePerMin && ratePerMin > 0) {
    b.tokens = ratePerMin;
  }
  if (b.tokens <= 0) return false;
  b.tokens -= 1;
  return true;
}

/**
 * Peek at a bucket without consuming — useful for admin dashboards. Returns
 * `null` when the tenant has never sent (no bucket allocated yet).
 */
export function peekBucket(tenantId: string): Bucket | null {
  const b = buckets.get(tenantId);
  return b ? { ...b } : null;
}

/** Test-only helper — wipes all buckets. Not exported from index by default. */
export function _resetBuckets(): void {
  buckets.clear();
}
