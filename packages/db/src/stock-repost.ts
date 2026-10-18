// Stock repost — pure recomputation of the moving-average valuation chain
// for a single (item, warehouse) bin, given the SLEs at + after a
// specified fromDate.
//
// Preconditions the caller enforces:
//   - `priorQty` + `priorRate` + `priorValue` reflect the bin's state
//     immediately BEFORE fromDate (i.e. from active SLEs older than fromDate).
//   - `activeSles` are the SLEs at or after fromDate, ordered ASC by
//     (postingDate, createdAt) — same order the ledger reads them.
//   - All caller SLEs have already been validated as non-cancelled.
//
// The helper returns per-SLE updates the caller writes back (updating
// qtyAfterTransaction, valuationRate, stockValue on each) plus the final
// bin state. Same moving-average rules as `rebuildBin` in stock-posting.ts
// (which computes the aggregate) — but here we also emit the per-row
// snapshot so historical Stock Ledger reports show accurate valuation.

export interface SleForRepost {
  id: string;
  actualQty: number;              // signed
  incomingRate: number;           // used only for inflows
}

export interface RepostSleUpdate {
  id: string;
  qtyAfterTransaction: number;
  valuationRate: number;          // running average after this SLE
  stockValue: number;              // running bin value after this SLE
}

export interface RepostResult {
  updates: RepostSleUpdate[];
  finalQty: number;
  finalRate: number;
  finalValue: number;
}

/**
 * Recompute the SLE valuation chain forward. Mirrors the algorithm in
 * `stock-posting.ts::rebuildBin` and `postStockEntries` — moving average
 * for inflows, consume-at-avg for outflows, zero-clamped when qty drops
 * below EPSILON.
 */
export function recomputeSleChain(input: {
  priorQty: number;
  priorRate: number;
  priorValue: number;
  activeSles: SleForRepost[];
}): RepostResult {
  let qty = input.priorQty;
  let rate = input.priorRate;
  let value = input.priorValue;
  const updates: RepostSleUpdate[] = [];

  for (const sle of input.activeSles) {
    if (sle.actualQty > 0) {
      // Inflow at incomingRate → moving average pulls toward that value.
      qty += sle.actualQty;
      value += sle.actualQty * sle.incomingRate;
      rate = qty > 0 ? value / qty : 0;
    } else if (sle.actualQty < 0) {
      // Outflow at current avg.
      const qtyOut = -sle.actualQty;
      qty -= qtyOut;
      value -= qtyOut * rate;
      if (qty < 0.0001) {
        qty = 0;
        value = 0;
      }
      rate = qty > 0 ? value / qty : 0;
    }
    // actualQty === 0 (value-only SLE, from LCV or stock recon rate-only)
    // — pass through untouched. The SLE's own valuationRate + stockValue
    // are informational; the rebuild ignores them.
    updates.push({
      id: sle.id,
      qtyAfterTransaction: round4(qty),
      valuationRate: round4(rate),
      stockValue: round4(value),
    });
  }

  return {
    updates,
    finalQty: round4(qty),
    finalRate: round4(rate),
    finalValue: round4(value),
  };
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
