// Batch expiry — pure helpers for the scheduler tick that alerts stock
// managers on batches that are expired or expiring soon. Split from the
// tick body so the classification rules (window, statuses) are tested
// without a live DB.
//
// The scheduler tick reads Batches, runs each through classifyBatchExpiry,
// and creates a Notification per SystemManager for any batch whose status
// deserves an alert AND hasn't already been alerted recently (dedup via
// Batch.lastExpiryAlertAt).

export type BatchExpiryStatus =
  | "expired"    // expiryDate is in the past
  | "expiring"   // expiryDate within `windowDays` of `today`
  | "ok"         // expiryDate is set but comfortably in the future
  | "no-expiry"; // no expiryDate on the batch

export interface BatchExpiryLike {
  id: string;
  expiryDate: Date | null;
  batchQty: number | string | { toString(): string };
  disabled?: boolean;
  lastExpiryAlertAt?: Date | null;
}

export interface BatchExpiryResult {
  status: BatchExpiryStatus;
  /** null when there's no expiryDate. Otherwise days from `today` to
   *  expiryDate (negative if already expired). */
  daysUntilExpiry: number | null;
}

function asNumber(v: number | string | { toString(): string }): number {
  if (typeof v === "number") return v;
  return Number(v.toString());
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Classify a single batch against `today` and an alert window.
 *
 * Rules:
 *   - `expiryDate == null` → "no-expiry" (never alerts).
 *   - Days until expiry compared on UTC-midnight so a batch expiring
 *     today isn't flipped to "expired" an hour before the day rolls over.
 *   - `daysUntilExpiry < 0` → "expired".
 *   - `0 ≤ daysUntilExpiry ≤ windowDays` → "expiring".
 *   - Beyond the window → "ok".
 *
 * Does NOT consider `disabled` or `batchQty` — the caller pre-filters
 * so this helper stays purely about time math.
 */
export function classifyBatchExpiry(
  batch: BatchExpiryLike,
  today: Date,
  windowDays: number,
): BatchExpiryResult {
  if (!batch.expiryDate) return { status: "no-expiry", daysUntilExpiry: null };

  const expiryMid = Date.UTC(
    batch.expiryDate.getUTCFullYear(),
    batch.expiryDate.getUTCMonth(),
    batch.expiryDate.getUTCDate(),
  );
  const todayMid = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  );
  const days = Math.floor((expiryMid - todayMid) / MS_PER_DAY);

  if (days < 0) return { status: "expired", daysUntilExpiry: days };
  if (days <= windowDays) return { status: "expiring", daysUntilExpiry: days };
  return { status: "ok", daysUntilExpiry: days };
}

export interface AlertPickInput {
  today: Date;
  windowDays: number;
  /** Only re-alert a batch if the last alert was at least this long ago.
   *  Prevents a Notification spam every tick after the tenant misses a
   *  cleanup window. */
  reAlertAfterDays: number;
}

/**
 * Filter `batches` down to the ones that (a) have non-zero remaining qty,
 * (b) aren't disabled, (c) classify as "expired" or "expiring", AND
 * (d) haven't been alerted within `reAlertAfterDays`.
 *
 * Ordering: expired first (worst status), then expiring by soonest
 * expiryDate. Callers can trim by `MAX_PER_TICK` and know they're
 * handling the most urgent first.
 */
export function pickBatchesForAlert(
  batches: BatchExpiryLike[],
  input: AlertPickInput,
): Array<{ batch: BatchExpiryLike; result: BatchExpiryResult }> {
  const cutoffMs =
    input.today.getTime() - input.reAlertAfterDays * MS_PER_DAY;
  const eligible: Array<{ batch: BatchExpiryLike; result: BatchExpiryResult }> = [];
  for (const b of batches) {
    if (b.disabled) continue;
    if (asNumber(b.batchQty) <= 0) continue;
    const r = classifyBatchExpiry(b, input.today, input.windowDays);
    if (r.status !== "expired" && r.status !== "expiring") continue;
    if (b.lastExpiryAlertAt && b.lastExpiryAlertAt.getTime() > cutoffMs) continue;
    eligible.push({ batch: b, result: r });
  }
  eligible.sort((a, b) => {
    // Expired ranks worst → first.
    if (a.result.status !== b.result.status) {
      return a.result.status === "expired" ? -1 : 1;
    }
    // Within same status, earliest expiry first.
    return (a.result.daysUntilExpiry ?? 0) - (b.result.daysUntilExpiry ?? 0);
  });
  return eligible;
}
