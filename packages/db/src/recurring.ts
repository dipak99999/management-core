// Recurring Invoice — pure helpers. Extracted from the scheduler's
// per-tick loop so the admin UI can preview upcoming runs without a DB
// query and so both the scheduler + the "run now" route stay consistent
// on how nextRunDate advances.
//
// Kept dependency-free so vitest can pin the cadence math (month rollover,
// leap-year Feb 29, end-of-schedule) without touching Prisma.

export type Frequency = "Daily" | "Weekly" | "Monthly" | "Quarterly" | "Yearly";

/**
 * Move a date forward by one cadence step. Frequency + intervalCount
 * together define the step (e.g. Monthly × 3 = every quarter).
 * Idempotent w.r.t. time-of-day — always snaps to UTC midnight so a
 * template scheduled at 09:00 GMT doesn't drift by DST changes.
 */
export function advanceRecurringDate(
  from: Date,
  frequency: Frequency,
  intervalCount: number,
): Date {
  const d = new Date(from);
  d.setUTCHours(0, 0, 0, 0);
  const n = Math.max(1, Math.floor(intervalCount));
  switch (frequency) {
    case "Daily":
      d.setUTCDate(d.getUTCDate() + n);
      break;
    case "Weekly":
      d.setUTCDate(d.getUTCDate() + n * 7);
      break;
    case "Monthly":
      d.setUTCMonth(d.getUTCMonth() + n);
      break;
    case "Quarterly":
      d.setUTCMonth(d.getUTCMonth() + n * 3);
      break;
    case "Yearly":
      d.setUTCFullYear(d.getUTCFullYear() + n);
      break;
  }
  return d;
}

/**
 * Preview the next N run dates for a template — used by the admin detail
 * page so the operator can visually confirm the schedule ("next 6
 * months will bill on the 15th"). Respects endDate; returns fewer than
 * N when the schedule ends earlier. Pass `count=1` to see just the
 * upcoming date.
 */
export function previewUpcomingRuns(input: {
  frequency: Frequency;
  intervalCount: number;
  nextRunDate: Date;
  endDate?: Date | null;
  count: number;
}): Date[] {
  const out: Date[] = [];
  const end = input.endDate ?? null;
  let cursor = new Date(input.nextRunDate);
  cursor.setUTCHours(0, 0, 0, 0);
  for (let i = 0; i < input.count; i++) {
    if (end && cursor > end) break;
    out.push(new Date(cursor));
    cursor = advanceRecurringDate(cursor, input.frequency, input.intervalCount);
  }
  return out;
}

/**
 * The rule the scheduler uses to decide when a template has reached its
 * `endDate` and should flip to Ended. Extracted so both the scheduler
 * loop and the admin detail page's "days remaining" widget agree.
 * Returns true when the *next* run would fall past `endDate`.
 */
export function isScheduleExhausted(
  nextRun: Date,
  endDate: Date | null | undefined,
): boolean {
  if (!endDate) return false;
  const n = new Date(nextRun);
  n.setUTCHours(0, 0, 0, 0);
  const e = new Date(endDate);
  e.setUTCHours(0, 0, 0, 0);
  return n > e;
}
