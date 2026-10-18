// Leave Ledger — pure helpers for the append-only per-(employee, leaveType)
// balance log. Before this file, the write hooks on LeaveAllocation +
// LeaveApplication approve + LeaveEncashment were deferred ("added in a
// follow-up commit" per the note at leave-ledger.ts:14), so the ledger
// was empty until the backfill endpoint ran manually. Now the flows call
// these builders inline so the ledger stays authoritative.
//
// Sign convention (matches the backfill in leave-ledger.ts):
//   Allocation, Adjustment (positive), Opening, CarryForward — POSITIVE
//     leaves credit the balance.
//   Consumption, Encashment, Expiry, Adjustment (negative) — NEGATIVE.
// The caller signs the number correctly; this helper doesn't force sign.

export type LeaveEntryType =
  | "Allocation"
  | "Consumption"
  | "Adjustment"
  | "Encashment"
  | "Expiry"
  | "CarryForward"
  | "Opening";

export interface LeaveLedgerRowInput {
  employeeId: string;
  leaveTypeId: string;
  postingDate: Date;
  entryType: LeaveEntryType;
  leaves: number; // signed; caller decides
  fromDate?: Date | null;
  toDate?: Date | null;
  /** Denormalized from the Employee at write time so the report can
   *  filter/group by them without a join. */
  workGroupId?: string | null;
  employeeCategoryId?: string | null;
  sourceDoctype?: string | null;
  sourceDocId?: string | null;
  reason?: string | null;
  createdBy?: string | null;
}

export interface LeaveLedgerRowReady extends LeaveLedgerRowInput {
  balanceAfter: number;
  isCarryForward: boolean;
  isExpired: boolean;
  isEncashment: boolean;
}

/**
 * Compute `balanceAfter` from a set of existing entries (queried by the
 * caller for this employee+leaveType) plus the new entry's `leaves`.
 *
 * Rule: `sum(prior.leaves) + new.leaves`. Not date-scoped — Prisma
 * queries typically pull "everything for this pair" and let this
 * helper reduce. If the caller wants an as-of snapshot they can
 * pre-filter by postingDate before passing.
 */
export function computeBalanceAfter(
  priorLeaves: Array<{ leaves: number | string | { toString(): string } }>,
  incomingLeaves: number,
): number {
  let sum = 0;
  for (const e of priorLeaves) {
    sum += asNumber(e.leaves);
  }
  const total = sum + incomingLeaves;
  // Round to 2dp to keep the ledger tidy — leave days are usually
  // half-day granular but arithmetic can drift on repeated adjustments.
  return Math.round(total * 100) / 100;
}

/**
 * Given a raw row input + a computed balanceAfter, produce the exact
 * shape the LeaveLedgerEntry create expects (with the boolean flags
 * derived from entryType).
 */
export function finalizeLedgerRow(
  input: LeaveLedgerRowInput,
  balanceAfter: number,
): LeaveLedgerRowReady {
  return {
    ...input,
    balanceAfter: Math.round(balanceAfter * 100) / 100,
    isCarryForward: input.entryType === "CarryForward",
    isExpired: input.entryType === "Expiry",
    isEncashment: input.entryType === "Encashment",
  };
}

/**
 * Convenience constructor — matches how the LeaveAllocation POST /
 * LeavePolicy /apply flow uses it: takes the allocation values and returns
 * a ready-to-insert row (signed +positive since Allocation credits the balance).
 */
export function buildAllocationRow(input: {
  employeeId: string;
  leaveTypeId: string;
  postingDate: Date;
  fromDate: Date;
  toDate: Date;
  totalLeaves: number;
  allocationId: string;
  workGroupId?: string | null;
  employeeCategoryId?: string | null;
  reason?: string | null;
  createdBy?: string | null;
}): LeaveLedgerRowInput {
  return {
    employeeId: input.employeeId,
    leaveTypeId: input.leaveTypeId,
    postingDate: input.postingDate,
    entryType: "Allocation",
    leaves: input.totalLeaves,
    fromDate: input.fromDate,
    toDate: input.toDate,
    workGroupId: input.workGroupId ?? null,
    employeeCategoryId: input.employeeCategoryId ?? null,
    sourceDoctype: "LeaveAllocation",
    sourceDocId: input.allocationId,
    reason: input.reason ?? null,
    createdBy: input.createdBy ?? null,
  };
}

/**
 * Convenience constructor for a Consumption row fired on LeaveApplication
 * approve. `days` is the raw request; we NEGATE here so the caller
 * doesn't have to remember the sign convention.
 */
export function buildConsumptionRow(input: {
  employeeId: string;
  leaveTypeId: string;
  postingDate: Date;
  fromDate: Date;
  toDate: Date;
  days: number; // POSITIVE — helper signs it
  applicationId: string;
  workGroupId?: string | null;
  employeeCategoryId?: string | null;
  createdBy?: string | null;
}): LeaveLedgerRowInput {
  return {
    employeeId: input.employeeId,
    leaveTypeId: input.leaveTypeId,
    postingDate: input.postingDate,
    entryType: "Consumption",
    leaves: -Math.abs(input.days),
    fromDate: input.fromDate,
    toDate: input.toDate,
    workGroupId: input.workGroupId ?? null,
    employeeCategoryId: input.employeeCategoryId ?? null,
    sourceDoctype: "LeaveApplication",
    sourceDocId: input.applicationId,
    reason: "Approved leave application",
    createdBy: input.createdBy ?? null,
  };
}

/**
 * Convenience constructor for an Encashment row fired on LeaveEncashment
 * pay. Signed NEGATIVE (helper takes abs then negates) so callers stay
 * uniform with `buildConsumptionRow`. The compensating negative
 * LeaveAllocation the encashment route creates for balance-check
 * backwards-compat is intentionally NOT mirrored to the ledger — only
 * this Encashment row appears, so the balance drops exactly once.
 */
export function buildEncashmentRow(input: {
  employeeId: string;
  leaveTypeId: string;
  postingDate: Date;
  days: number; // POSITIVE — helper signs it
  encashmentId: string;
  encashmentName?: string | null;
  workGroupId?: string | null;
  employeeCategoryId?: string | null;
  createdBy?: string | null;
}): LeaveLedgerRowInput {
  return {
    employeeId: input.employeeId,
    leaveTypeId: input.leaveTypeId,
    postingDate: input.postingDate,
    entryType: "Encashment",
    leaves: -Math.abs(input.days),
    workGroupId: input.workGroupId ?? null,
    employeeCategoryId: input.employeeCategoryId ?? null,
    sourceDoctype: "LeaveEncashment",
    sourceDocId: input.encashmentId,
    reason: input.encashmentName
      ? `Leave encashment ${input.encashmentName}`
      : "Leave encashment",
    createdBy: input.createdBy ?? null,
  };
}

/**
 * Reverse a previous Encashment on LeaveEncashment cancel-of-Paid.
 * POSITIVE-signed Adjustment that restores the balance without mutating
 * the original Encashment row (append-only).
 */
export function buildEncashmentReversalRow(input: {
  employeeId: string;
  leaveTypeId: string;
  postingDate: Date;
  days: number;
  encashmentId: string;
  encashmentName?: string | null;
  workGroupId?: string | null;
  employeeCategoryId?: string | null;
  createdBy?: string | null;
}): LeaveLedgerRowInput {
  return {
    employeeId: input.employeeId,
    leaveTypeId: input.leaveTypeId,
    postingDate: input.postingDate,
    entryType: "Adjustment",
    leaves: Math.abs(input.days),
    workGroupId: input.workGroupId ?? null,
    employeeCategoryId: input.employeeCategoryId ?? null,
    sourceDoctype: "LeaveEncashment",
    sourceDocId: input.encashmentId,
    reason: input.encashmentName
      ? `Cancellation of leave encashment ${input.encashmentName}`
      : "Cancellation of leave encashment",
    createdBy: input.createdBy ?? null,
  };
}

/**
 * Reverse a previous Consumption — used on LeaveApplication cancel of an
 * already-Approved app. Emits a POSITIVE-signed Adjustment row that
 * restores the balance. We use Adjustment (not "unmark the original")
 * because the ledger is append-only.
 */
export function buildConsumptionReversalRow(input: {
  employeeId: string;
  leaveTypeId: string;
  postingDate: Date;
  days: number;
  applicationId: string;
  workGroupId?: string | null;
  employeeCategoryId?: string | null;
  createdBy?: string | null;
}): LeaveLedgerRowInput {
  return {
    employeeId: input.employeeId,
    leaveTypeId: input.leaveTypeId,
    postingDate: input.postingDate,
    entryType: "Adjustment",
    leaves: Math.abs(input.days),
    workGroupId: input.workGroupId ?? null,
    employeeCategoryId: input.employeeCategoryId ?? null,
    sourceDoctype: "LeaveApplication",
    sourceDocId: input.applicationId,
    reason: "Cancellation of approved leave application",
    createdBy: input.createdBy ?? null,
  };
}

function asNumber(v: number | string | { toString(): string }): number {
  if (typeof v === "number") return v;
  return Number(v.toString());
}
