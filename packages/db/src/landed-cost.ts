// Landed Cost Voucher — pure helpers for the allocation math.
// LCV capitalizes freight/customs/duty paid separately onto items from
// one or more Purchase Receipts. The submit route does DB reads/writes;
// this file owns the arithmetic: how to spread the total tax pool across
// the PR items pro-rata, and how to aggregate item+warehouse duplicates
// into a single per-bin bump.
//
// Keeping this pure means we can (a) unit-test the pro-rata rounding
// invariants (sum-of-shares must equal total cost to the cent), and
// (b) reuse the shape from a future "preview allocation" UI without
// re-running the DB tx.

export interface LandedCostItemInput {
  /** Purchase-receipt name — kept for reporting; not used in math. */
  prName: string;
  itemId: string;
  warehouseId: string;
  qty: number;
  rate: number;
}

export interface LandedCostTaxInput {
  amount: number;
}

export interface LandedCostBump {
  itemId: string;
  warehouseId: string;
  /** Per-item+warehouse total capitalized cost, currency, 4dp. */
  addValue: number;
}

export interface AllocationResult {
  /** One bump per (itemId, warehouseId) key — inputs that share a key
   *  are summed. */
  bumps: LandedCostBump[];
  /** Grand total across all bumps. Equals `sum(taxes.amount)` to the cent. */
  totalCost: number;
}

/**
 * Allocate the total tax pool across PR items, weighted by each item's
 * base amount (qty × rate). Items sharing (itemId, warehouseId) collapse
 * into a single bump so the caller writes at most one SLE per bin.
 *
 * Contract:
 *   - Throws when `sum(qty*rate) <= 0` — can't pro-rata against zero base.
 *   - **Last bump absorbs the sub-cent rounding remainder** so
 *     `sum(bumps.addValue) === totalCost` to the cent. Auditors dislike
 *     landed-cost postings that don't tie back exactly.
 *   - Bump order is stable — matches first-occurrence order of the
 *     (itemId, warehouseId) key in `items`.
 */
export function allocateLandedCost(
  taxes: LandedCostTaxInput[],
  items: LandedCostItemInput[],
): AllocationResult {
  const totalCost = round4(taxes.reduce((s, t) => s + t.amount, 0));
  if (items.length === 0) {
    if (totalCost > 0)
      throw new Error(
        "Cannot allocate: LCV has taxes but no purchase-receipt items",
      );
    return { bumps: [], totalCost };
  }

  const totalBase = items.reduce((s, l) => s + l.qty * l.rate, 0);
  if (totalBase <= 0)
    throw new Error(
      "Cannot allocate: purchase receipt items have zero base value (qty × rate)",
    );

  // Preserve first-occurrence order via an insertion-ordered Map.
  const map = new Map<string, LandedCostBump>();
  const order: string[] = [];
  for (const l of items) {
    const key = `${l.itemId}::${l.warehouseId}`;
    const share = round4(((l.qty * l.rate) / totalBase) * totalCost);
    const prev = map.get(key);
    if (prev) {
      prev.addValue = round4(prev.addValue + share);
    } else {
      map.set(key, {
        itemId: l.itemId,
        warehouseId: l.warehouseId,
        addValue: share,
      });
      order.push(key);
    }
  }

  const bumps = order.map((k) => map.get(k)!);
  // Absorb the rounding remainder into the last bump so the invariant
  // `sum(bumps.addValue) === totalCost` holds exactly. Same trick as the
  // payment-schedule helper.
  if (bumps.length > 0) {
    const currentSum = round4(bumps.reduce((s, b) => s + b.addValue, 0));
    const diff = round4(totalCost - currentSum);
    if (Math.abs(diff) > 0) {
      bumps[bumps.length - 1]!.addValue = round4(
        bumps[bumps.length - 1]!.addValue + diff,
      );
    }
  }

  return { bumps, totalCost };
}

/**
 * Compute the new (stockValue, valuationRate) for a bin after applying
 * a landed-cost bump. `actualQty` doesn't change (LCV is valuation-only).
 * When qty is 0 the rate falls back to 0 — division-by-zero guard.
 */
export function applyBumpToBin(
  bin: { stockValue: number; actualQty: number },
  bump: { addValue: number },
): { stockValue: number; valuationRate: number } {
  const newStockValue = round4(bin.stockValue + bump.addValue);
  const newValuationRate =
    bin.actualQty > 0 ? round4(newStockValue / bin.actualQty) : 0;
  return { stockValue: newStockValue, valuationRate: newValuationRate };
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
