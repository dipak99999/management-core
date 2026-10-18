// Deferred Revenue — pure helpers for materializing the monthly recognition
// schedule on SI submit, and computing which rows are due for booking on
// each scheduler tick.
//
// The recognition rule is straight-line: divide the deferred amount into
// N equal monthly installments starting from `startDate`. Last installment
// absorbs the sub-cent rounding remainder so `sum(rows.amount) === total`
// to the cent — same trick as payment-schedule materialization (module 17)
// and landed-cost allocation (module 19).

export interface DeferredScheduleRowInput {
  installmentNo: number;   // 1-based
  dueDate: Date;
  amount: number;          // 2dp currency
}

/**
 * Materialize N monthly recognition rows for a deferred SI line.
 *
 *   startDate → installment 1's dueDate. Subsequent rows land on the
 *   same day of subsequent months. Handles month rollover naturally via
 *   Date arithmetic (setUTCMonth). Feb-30 edge case: if the start day
 *   doesn't exist in a later month (e.g. start on Jan 31 → Feb has no
 *   31st), Date rolls forward to March 3rd — same as ERPNext's default.
 *
 * Contract:
 *   - months ≤ 0 → returns [] (caller falls back to immediate recognition)
 *   - totalAmount ≤ 0 → returns [] (nothing to recognize)
 *   - Last row absorbs the rounding remainder to preserve
 *     sum(rows.amount) === totalAmount to the cent.
 */
export function computeDeferredSchedule(
  totalAmount: number,
  months: number,
  startDate: Date,
): DeferredScheduleRowInput[] {
  if (months <= 0 || totalAmount <= 0) return [];

  const per = Math.round((totalAmount / months) * 100) / 100;
  const rows: DeferredScheduleRowInput[] = [];
  let allocated = 0;
  for (let i = 0; i < months; i++) {
    const d = new Date(
      Date.UTC(
        startDate.getUTCFullYear(),
        startDate.getUTCMonth() + i,
        startDate.getUTCDate(),
      ),
    );
    const isLast = i === months - 1;
    const amount = isLast
      ? Math.round((totalAmount - allocated) * 100) / 100
      : per;
    if (!isLast) allocated += per;
    rows.push({
      installmentNo: i + 1,
      dueDate: d,
      amount,
    });
  }
  return rows;
}
