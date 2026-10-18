// Product Bundle — pure helpers. Called from services/crm-service/src/
// routes/sales-orders.ts at SO → DN convert time to expand bundle lines
// into component DN lines.
//
// Kept dependency-free so vitest can exercise the expansion + validation
// (self-reference, missing component, qty math) without a live DB.

export interface BundleComponentInput {
  componentItemId: string;
  qty: number;
  sortOrder?: number | null;
}

export interface BundleInput {
  parentItemId: string;
  components: BundleComponentInput[];
}

/**
 * Validate a bundle definition before persisting. Returns a human-readable
 * error string or null on success. Enforces:
 *   - at least one component
 *   - no self-reference (parent listed as its own component)
 *   - no duplicate componentItemId (the unique index catches DB-side too,
 *     but a friendly error beats a P2002)
 *   - every qty > 0
 */
export function validateBundleDefinition(input: BundleInput): string | null {
  if (input.components.length === 0) {
    return "A bundle must have at least one component.";
  }
  const seen = new Set<string>();
  for (const c of input.components) {
    if (c.componentItemId === input.parentItemId) {
      return "A bundle cannot list itself as a component.";
    }
    if (seen.has(c.componentItemId)) {
      return `Component ${c.componentItemId} listed more than once — bump its qty instead.`;
    }
    seen.add(c.componentItemId);
    if (!(c.qty > 0)) {
      return `Component qty must be > 0 (component ${c.componentItemId}).`;
    }
  }
  return null;
}

// -----------------------------------------------------------------------
// Expansion. Called by convert-to-DN when the SO line's item is a bundle.

export interface SoLineForExpansion {
  id: string;             // SalesOrderItem.id — preserved as salesOrderItemId on every emitted DN line
  itemId: string;         // the bundle parent
  qty: number;            // qty of the bundle being delivered
}

export interface BundleDefLike {
  parentItemId: string;
  components: { componentItemId: string; qty: number; sortOrder?: number | null }[];
}

export interface ExpandedDnLine {
  itemId: string;         // component item
  qty: number;            // bundleQty × componentQty
  salesOrderItemId: string;
}

/**
 * Given a Sales Order line for a bundle parent + the bundle definition,
 * return one ExpandedDnLine per component with quantity = SO qty × comp qty.
 * Preserves the SalesOrderItem.id as salesOrderItemId so downstream code
 * (billed-qty tally, audit) still links back to the source line.
 *
 * Components are emitted in sortOrder (nulls last), matching the pack-list
 * order the operator sees in the bundle editor.
 */
export function expandBundleLine(
  soLine: SoLineForExpansion,
  bundle: BundleDefLike,
): ExpandedDnLine[] {
  const sorted = [...bundle.components].sort((a, b) => {
    const ao = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
    const bo = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
    return ao - bo;
  });
  return sorted.map((c) => ({
    itemId: c.componentItemId,
    qty: soLine.qty * c.qty,
    salesOrderItemId: soLine.id,
  }));
}

/**
 * Convenience: given a mixed list of SO lines (some bundles, some regular
 * items) + a lookup of bundle definitions keyed by parent item id, return
 * the fully-expanded DN line list. Non-bundle lines pass through unchanged.
 *
 * `resolveWarehouse` is applied per emitted line so callers can either
 * stamp a single warehouse or plumb per-item overrides — the pure helper
 * doesn't care.
 */
export function expandBundleLines<T extends SoLineForExpansion>(
  soLines: T[],
  bundleDefs: Map<string, BundleDefLike>,
  resolveWarehouse: (itemId: string) => string,
): {
  itemId: string;
  qty: number;
  warehouseId: string;
  salesOrderItemId: string;
}[] {
  const out: {
    itemId: string;
    qty: number;
    warehouseId: string;
    salesOrderItemId: string;
  }[] = [];
  for (const l of soLines) {
    const bundle = bundleDefs.get(l.itemId);
    if (!bundle) {
      out.push({
        itemId: l.itemId,
        qty: l.qty,
        warehouseId: resolveWarehouse(l.itemId),
        salesOrderItemId: l.id,
      });
      continue;
    }
    for (const expanded of expandBundleLine(l, bundle)) {
      out.push({
        itemId: expanded.itemId,
        qty: expanded.qty,
        warehouseId: resolveWarehouse(expanded.itemId),
        salesOrderItemId: expanded.salesOrderItemId,
      });
    }
  }
  return out;
}
