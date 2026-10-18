// Deal splits — pure helpers for validating salesperson allocations
// on a SalesInvoice and computing commission.
//
// Data model (see schema SalesInvoiceSalesPersonAllocation):
//   { salesPersonId, allocationPct, commissionRate }
//   allocationPct — 0..100, sum across all rows for one SI === 100 ± 0.01
//   commissionRate — 0..100, applied to (netAmount * allocationPct / 100)
//
// The tolerance is small enough to catch obvious mistakes (99.5, 101)
// but loose enough that a UI splitting to 3 people can pick 33.333 %
// each without failing.

export const ALLOCATION_SUM_TOLERANCE = 0.01;

export interface AllocationInput {
  salesPersonId: string;
  allocationPct: number;
  commissionRate?: number;
}

export interface AllocationValidationResult {
  ok: boolean;
  error?: string;
  sum: number;
}

export function validateAllocations(rows: AllocationInput[]): AllocationValidationResult {
  if (rows.length === 0) return { ok: true, sum: 0 };
  const seen = new Set<string>();
  for (const r of rows) {
    if (!r.salesPersonId) return { ok: false, error: "salesPersonId required on every row", sum: 0 };
    if (seen.has(r.salesPersonId)) return { ok: false, error: `Duplicate salesPersonId ${r.salesPersonId}`, sum: 0 };
    seen.add(r.salesPersonId);
    if (r.allocationPct < 0 || r.allocationPct > 100) {
      return { ok: false, error: "allocationPct must be between 0 and 100", sum: 0 };
    }
    if (r.commissionRate != null && (r.commissionRate < 0 || r.commissionRate > 100)) {
      return { ok: false, error: "commissionRate must be between 0 and 100", sum: 0 };
    }
  }
  const sum = rows.reduce((s, r) => s + Number(r.allocationPct), 0);
  if (Math.abs(sum - 100) > ALLOCATION_SUM_TOLERANCE) {
    return { ok: false, error: `Allocations sum to ${sum.toFixed(3)}%, must sum to 100%`, sum };
  }
  return { ok: true, sum };
}

// Commission per salesperson on one SalesInvoice.
// `netRevenue` is what commissions are computed against — usually
// SalesInvoice.grandTotal minus tax (caller's decision; we take a plain
// number so different companies can plug in "net of returns" etc.).
export interface CommissionLine {
  salesPersonId: string;
  allocationPct: number;
  commissionRate: number;
  attributedRevenue: number;
  commissionAmount: number;
}

export function computeCommissions(
  rows: AllocationInput[],
  netRevenue: number,
): CommissionLine[] {
  return rows.map((r) => {
    const attributedRevenue = (netRevenue * Number(r.allocationPct)) / 100;
    const rate = Number(r.commissionRate ?? 0);
    return {
      salesPersonId: r.salesPersonId,
      allocationPct: Number(r.allocationPct),
      commissionRate: rate,
      attributedRevenue,
      commissionAmount: (attributedRevenue * rate) / 100,
    };
  });
}
