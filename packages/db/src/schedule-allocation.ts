// Schedule allocation — pure helpers for FIFO Payment Entry apply → invoice
// payment schedule row allocation, and LIFO reversal on PE cancel.
//
// The invariant this file maintains, across a series of applies and
// cancels: `sum(row.paidAmount for row in schedule) === sum(ref.allocatedAmount for ref
// in PaymentEntryReferences pointing at the invoice)`. When there's no
// schedule, this file isn't invoked — the invoice's outstandingAmt is the
// only paid-tracker.
//
// The scheduler tick and reminders module still key off SalesInvoice.dueDate
// (the latest installment) — per-installment reminders are a separate
// follow-up; here we just track paid-per-row so the UI shows accurate
// Paid/Partial/Overdue status without pattern-matching parent status.

export interface AllocatableRow {
  id: string;
  dueDate: Date;
  sortOrder: number;
  amount: number;      // installment amount, 2-4dp currency
  paidAmount: number;  // already-applied against this row
}

export interface RowChange {
  id: string;
  /** Positive = additional payment; negative = reversal. Callers add this
   *  to the row's existing `paidAmount` and derive status from the sum. */
  paidDelta: number;
  /** Final paidAmount after applying paidDelta — convenience for status
   *  derivation without re-reading the row. */
  newPaidAmount: number;
}

export interface AllocationResult {
  changes: RowChange[];
  /** Amount that couldn't be applied (overflow beyond total unpaid).
   *  For allocate: usually 0; non-zero means over-payment.
   *  For reverse:  non-zero means the caller tried to reverse more than
   *                was applied. Both cases are informational — the caller
   *                decides whether to error. */
  remainder: number;
}

/**
 * Allocate `incoming` currency across `rows` FIFO (oldest dueDate first;
 * ties break by sortOrder).
 *
 * Rules:
 *   - A row's `remaining = amount - paidAmount`. Fill each row's remaining
 *     before moving to the next.
 *   - Fully-paid rows (remaining <= 0.0001) are skipped without producing
 *     a change entry.
 *   - Any leftover after the last row is returned as `remainder` — the
 *     caller decides whether to error (usually yes, since PE apply
 *     validates against invoice outstanding first).
 *   - Zero or negative `incoming` returns empty changes + `remainder = incoming`.
 */
export function allocateToSchedule(
  rows: AllocatableRow[],
  incoming: number,
): AllocationResult {
  if (incoming <= 0.0001) return { changes: [], remainder: incoming };

  const sorted = [...rows].sort((a, b) => {
    const dt = a.dueDate.getTime() - b.dueDate.getTime();
    if (dt !== 0) return dt;
    return a.sortOrder - b.sortOrder;
  });

  let left = round4(incoming);
  const changes: RowChange[] = [];
  for (const row of sorted) {
    if (left <= 0.0001) break;
    const remaining = round4(row.amount - row.paidAmount);
    if (remaining <= 0.0001) continue; // already fully paid
    const apply = Math.min(remaining, left);
    changes.push({
      id: row.id,
      paidDelta: round4(apply),
      newPaidAmount: round4(row.paidAmount + apply),
    });
    left = round4(left - apply);
  }
  return { changes, remainder: round4(left) };
}

/**
 * Reverse `decrement` currency back off `rows` in LIFO order (most-recent
 * dueDate first; ties break by higher sortOrder first). Semantics: "undo
 * the most recent payment effect first" — the earliest installments
 * remain paid as long as possible, which mirrors intuition when only
 * PART of a cancellation would leave everything settled.
 *
 * Rules:
 *   - Skip rows with paidAmount == 0.
 *   - Never drive paidAmount negative — pull only up to the row's paid
 *     amount.
 *   - Any leftover after the earliest row is returned as `remainder`
 *     (over-reversal); caller decides.
 */
export function reverseFromSchedule(
  rows: AllocatableRow[],
  decrement: number,
): AllocationResult {
  if (decrement <= 0.0001) return { changes: [], remainder: decrement };

  const sorted = [...rows].sort((a, b) => {
    const dt = b.dueDate.getTime() - a.dueDate.getTime();
    if (dt !== 0) return dt;
    return b.sortOrder - a.sortOrder;
  });

  let left = round4(decrement);
  const changes: RowChange[] = [];
  for (const row of sorted) {
    if (left <= 0.0001) break;
    if (row.paidAmount <= 0.0001) continue;
    const pull = Math.min(row.paidAmount, left);
    changes.push({
      id: row.id,
      paidDelta: round4(-pull),
      newPaidAmount: round4(row.paidAmount - pull),
    });
    left = round4(left - pull);
  }
  return { changes, remainder: round4(left) };
}

/**
 * Given a row's final (dueDate, amount, paidAmount) + parent invoice
 * status + today, derive the per-row status. Same rules as
 * `scheduleItemStatus` in payment-schedule.ts but decoupled — payment-
 * schedule.ts is about materialization + initial status; this call site
 * runs after allocation so paidAmount is authoritative. Kept here as a
 * convenience so PE apply paths can compute the new status inline.
 */
export function derivePaidStatus(
  row: { dueDate: Date; amount: number; paidAmount: number },
  today: Date = new Date(),
  parentInvoiceStatus?: string,
): "Upcoming" | "Overdue" | "Paid" | "Partial" {
  if (parentInvoiceStatus === "Paid") return "Paid";
  if (row.paidAmount >= row.amount && row.amount > 0) return "Paid";
  if (row.paidAmount > 0) return "Partial";
  const dueMid = Date.UTC(
    row.dueDate.getUTCFullYear(),
    row.dueDate.getUTCMonth(),
    row.dueDate.getUTCDate(),
  );
  const todayMid = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  );
  return todayMid > dueMid ? "Overdue" : "Upcoming";
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
