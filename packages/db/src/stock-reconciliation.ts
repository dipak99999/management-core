// Stock Reconciliation — pure helpers for classifying a per-line count
// result into one of four cases (none / qty-only / rate-only / both) and
// computing the resulting GL value delta.
//
// Before this file, the route inlined the classification and dropped
// rate-only changes entirely — see the "future turn" comment in
// stock-reconciliations.ts. The math is now testable + the missing
// rate-only path lands in the route.
//
// Contract with the route:
//   - "none": skip the line entirely.
//   - "qty" | "both": route posts through postStockEntries (moving-average
//     inflow/outflow). incomingRate uses countedRate for gains.
//   - "rate": route writes a VALUE-ONLY SLE (actualQty=0) and directly
//     updates Bin.valuationRate + Bin.stockValue. Skipped by postStockEntries's
//     `if (actualQty === 0) continue` — this is the deferred path we're
//     closing.

export interface ReconInputs {
  oldQty: number;
  oldRate: number;
  countedQty: number;
  /**
   * When null, the caller left counted rate blank — treat as "same as old
   * rate" (no rate change). Matches the route's fallback:
   *   countedRate = l.countedValuationRate != null ? Number(...) : oldRate;
   */
  countedRate: number | null;
}

export type ReconMode = "none" | "qty" | "rate" | "both";

export interface ReconChange {
  mode: ReconMode;
  qtyDelta: number;    // countedQty - oldQty (0 for "none" | "rate")
  rateDelta: number;   // effectiveCountedRate - oldRate (0 for "none" | "qty")
  /**
   * GL-side value delta the caller will book to Stock-in-Hand vs Stock
   * Adjustment. Positive = stock gain (debit Stock-in-Hand).
   *   - qty:  qtyDelta × (gain ? countedRate : oldRate)
   *   - rate: oldQty × rateDelta
   *   - both: qty branch's value + rate branch's value using POST-qty bin
   *           qty. Because a rate-only bump uses the current bin qty AS OF
   *           the recon, and the qty part goes through postStockEntries
   *           first, the rate revaluation applies to `countedQty` (the
   *           new bin qty after the inflow/outflow).
   */
  valueDelta: number;
  /**
   * For "rate" mode: the new (stockValue, valuationRate) the route should
   * force onto the bin (qty unchanged). For "none"|"qty"|"both" the
   * caller relies on postStockEntries to maintain the bin; these fields
   * are 0.
   */
  newStockValue: number;
  newValuationRate: number;
}

const EPSILON = 0.0001;

/**
 * Classify + compute. Zero-length wiring — the route decides which
 * branch to take based on `mode`.
 */
export function classifyRecon(input: ReconInputs): ReconChange {
  const effectiveCountedRate =
    input.countedRate == null ? input.oldRate : input.countedRate;
  const qtyDelta = round4(input.countedQty - input.oldQty);
  const rateDelta = round4(effectiveCountedRate - input.oldRate);
  const qtyChanged = Math.abs(qtyDelta) >= EPSILON;
  const rateChanged = Math.abs(rateDelta) >= EPSILON;

  if (!qtyChanged && !rateChanged) {
    return {
      mode: "none",
      qtyDelta: 0,
      rateDelta: 0,
      valueDelta: 0,
      newStockValue: 0,
      newValuationRate: 0,
    };
  }

  if (qtyChanged && !rateChanged) {
    // Qty-only — matches the route's existing behavior. Value delta is
    // qty × the rate at which the flow occurred: countedRate for gains,
    // oldRate for losses (outflow consumes at existing avg).
    const rateForDelta = qtyDelta > 0 ? effectiveCountedRate : input.oldRate;
    return {
      mode: "qty",
      qtyDelta,
      rateDelta: 0,
      valueDelta: round4(qtyDelta * rateForDelta),
      newStockValue: 0,
      newValuationRate: 0,
    };
  }

  if (!qtyChanged && rateChanged) {
    // Rate-only — the deferred path. Bin qty is unchanged; we simply
    // revalue existing stock at the counted rate.
    const newStockValue = round4(input.countedQty * effectiveCountedRate);
    return {
      mode: "rate",
      qtyDelta: 0,
      rateDelta,
      valueDelta: round4(input.countedQty * rateDelta),
      newStockValue,
      newValuationRate: effectiveCountedRate,
    };
  }

  // Both changed. The route posts the qty piece through postStockEntries
  // (moving-average inflow at countedRate for gains, outflow at oldRate
  // for losses), and value delta accounts for both. We DO NOT emit a
  // separate rate-only SLE here — the moving-average from the qty inflow
  // is what ERPNext does for a mixed count. If a tenant needs strict
  // override semantics, they can do a qty-only recon followed by a
  // rate-only recon.
  const rateForQtyPart = qtyDelta > 0 ? effectiveCountedRate : input.oldRate;
  const qtyValuePart = qtyDelta * rateForQtyPart;
  const ratePart = input.oldQty * rateDelta;
  return {
    mode: "both",
    qtyDelta,
    rateDelta,
    valueDelta: round4(qtyValuePart + ratePart),
    newStockValue: 0,
    newValuationRate: 0,
  };
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
