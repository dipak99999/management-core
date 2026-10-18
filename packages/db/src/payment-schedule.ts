// Payment schedule — pure helpers for turning a PaymentTermsTemplate +
// (postingDate, invoiceTotal) into concrete installments, and for deriving
// each row's live status from (dueDate, paidAmount, parent-invoice status).
// SI/PI submit imports `materializeSchedule` to write the InvoicePaymentSchedule
// rows; the detail page imports `scheduleItemStatus` to render badges without
// duplicating rules server-side.

export interface PaymentTermsItemLike {
  description: string;
  invoicePortion: number | string | { toString(): string }; // percent 0..100
  dueDays: number;
  sortOrder: number;
}

export interface MaterializedScheduleRow {
  sortOrder: number;
  description: string;
  invoicePortion: number; // percent
  dueDate: Date;          // date-only (time zeroed)
  amount: number;         // currency, 2dp
}

function asNumber(v: number | string | { toString(): string }): number {
  if (typeof v === "number") return v;
  return Number(v.toString());
}

function dateAdd(base: Date, days: number): Date {
  // Anchor to UTC midnight so scheduled reminders / status calcs don't
  // wobble across DST transitions in tenant TZ.
  const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/**
 * Explode a template into concrete installments for an invoice.
 *
 * Rules:
 *   - Rows come out in sortOrder ascending (stable — ties preserve input order).
 *   - `dueDate` = postingDate + item.dueDays (UTC-anchored).
 *   - `amount` = round(invoiceTotal × portion / 100, 2). The LAST row absorbs
 *     the sub-cent rounding remainder so `sum(rows.amount) === invoiceTotal`
 *     to the cent, always. This matters for exports (auditors dislike
 *     schedules that sum to ₹99,999.98 for a ₹100k invoice).
 *   - Portions summing to ≠ 100 are permitted — this helper doesn't validate;
 *     the /payment-terms-templates POST/PUT does (`.refine(...)`). Non-100%
 *     input yields a schedule that sums to `total × (sumPortions / 100)`.
 *
 * Returns [] for `items = []` (no rows to materialize).
 */
export function materializeSchedule(
  items: PaymentTermsItemLike[],
  postingDate: Date,
  invoiceTotal: number,
): MaterializedScheduleRow[] {
  if (items.length === 0) return [];

  const sorted = [...items].sort((a, b) => a.sortOrder - b.sortOrder);
  const rows: MaterializedScheduleRow[] = [];
  let allocated = 0;

  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i]!;
    const portion = asNumber(t.invoicePortion);
    const isLast = i === sorted.length - 1;
    const raw = (invoiceTotal * portion) / 100;
    let amount = Math.round(raw * 100) / 100;
    if (isLast) {
      // Absorb the rounding remainder — protects the sum invariant even
      // when the individual rounds all went the same way.
      amount = Math.round((invoiceTotal - allocated) * 100) / 100;
    } else {
      allocated += amount;
    }
    rows.push({
      sortOrder: t.sortOrder,
      description: t.description,
      invoicePortion: portion,
      dueDate: dateAdd(postingDate, t.dueDays),
      amount,
    });
  }

  return rows;
}

export type ScheduleRowStatus = "Upcoming" | "Overdue" | "Paid" | "Partial";

export interface ScheduleRowStatusInput {
  dueDate: Date;
  amount: number | string | { toString(): string };
  paidAmount: number | string | { toString(): string };
  parentInvoiceStatus?: string; // "Draft" | "Submitted" | "Paid" | "Cancelled"
}

/**
 * Derived status for a single schedule row.
 *
 * Rules (checked in this order):
 *   1. Parent invoice Paid → row is Paid regardless of paidAmount allocation
 *      (until FIFO allocation on PE apply lands, paidAmount stays 0 but the
 *      invoice can still be fully paid via a lump PaymentEntry — the SI.status
 *      transition is authoritative).
 *   2. paidAmount ≥ amount → Paid.
 *   3. paidAmount > 0 → Partial.
 *   4. today > dueDate → Overdue.
 *   5. otherwise → Upcoming.
 */
export function scheduleItemStatus(input: ScheduleRowStatusInput, today: Date = new Date()): ScheduleRowStatus {
  if (input.parentInvoiceStatus === "Paid") return "Paid";
  const amt = asNumber(input.amount);
  const paid = asNumber(input.paidAmount);
  if (paid >= amt && amt > 0) return "Paid";
  if (paid > 0) return "Partial";
  // Compare on UTC dates only — otherwise a submit-at-23:59 in a UTC+11 tenant
  // would flag today's installment as overdue an hour later.
  const dueMid = new Date(
    Date.UTC(input.dueDate.getUTCFullYear(), input.dueDate.getUTCMonth(), input.dueDate.getUTCDate()),
  );
  const todayMid = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  );
  if (todayMid.getTime() > dueMid.getTime()) return "Overdue";
  return "Upcoming";
}

/**
 * Convenience: `dueDate` for the LAST installment in a materialized schedule.
 * Used at SI submit to overwrite the top-level SI.dueDate — the invoice
 * shouldn't be flagged fully overdue until the last installment lapses,
 * and reminders keep their existing "one dueDate per SI" contract.
 */
export function latestScheduleDueDate(rows: MaterializedScheduleRow[]): Date | null {
  if (rows.length === 0) return null;
  let latest = rows[0]!.dueDate;
  for (const r of rows) {
    if (r.dueDate.getTime() > latest.getTime()) latest = r.dueDate;
  }
  return latest;
}
