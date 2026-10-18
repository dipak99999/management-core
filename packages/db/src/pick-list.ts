// Module 47 — Pick List helpers.
//
// The aggregation logic takes a flat list of DN lines and returns them
// in an order that minimizes the worker's walk through the warehouse.
//
// v1 sort strategy: group by warehouse (workers finish one warehouse
// before moving to the next), then by warehouseName ASC within — so
// shelves ordered A/B/C are visited in that sequence. Real-world
// warehouses have a "pick path" master which we don't model yet;
// warehouseName lexical sort is a reasonable proxy.
//
// Pure — takes pre-fetched DN item rows, returns the sorted list.
// Data fetching lives in the route. That way the sort logic gets
// cheap unit tests, and other callers (a future "auto-pick from
// oldest DNs" scheduler) can reuse it.

export interface DNLineForPick {
  deliveryNoteItemId: string;
  itemId: string;
  warehouseId: string;
  warehouseName: string;
  qty: number;
  batchNo: string | null;
  serialNos: string[];
}

export interface PickRow {
  deliveryNoteItemId: string;
  itemId: string;
  warehouseId: string;
  qty: number;
  batchNo: string | null;
  serialNos: string[];
}

// Sorts lines by (warehouseName, itemId) so workers walk each
// warehouse once and pick related SKUs adjacently. Preserves the
// 1:1 relationship with DN lines (no cross-DN qty merging — each
// customer's order stays distinct on the pick sheet).
export function sortForPickWalk(lines: DNLineForPick[]): PickRow[] {
  const sorted = [...lines].sort((a, b) => {
    const w = a.warehouseName.localeCompare(b.warehouseName);
    if (w !== 0) return w;
    return a.itemId.localeCompare(b.itemId);
  });
  return sorted.map((l) => ({
    deliveryNoteItemId: l.deliveryNoteItemId,
    itemId: l.itemId,
    warehouseId: l.warehouseId,
    qty: l.qty,
    batchNo: l.batchNo,
    serialNos: l.serialNos,
  }));
}

// Progress: fraction of rows fully picked. When every row has
// pickedQty >= qty, returns 1.0 (100%). Callers use this to decide
// whether the PickList auto-flips Submitted → Completed.
export function pickProgress(rows: Array<{ qty: number; pickedQty: number }>): number {
  if (rows.length === 0) return 0;
  const done = rows.filter((r) => r.pickedQty >= r.qty).length;
  return done / rows.length;
}

// Called at PickList submit to guard: no DN line may appear on more
// than one active (non-Cancelled/Completed) PickList. Returns the
// list of DN line IDs that would double-book.
export interface ActiveConflict {
  deliveryNoteItemId: string;
  existingPickListName: string;
  existingPickListStatus: string;
}
export function findActiveConflicts(
  requestedDnLineIds: string[],
  existingActiveRows: Array<{
    deliveryNoteItemId: string;
    pickList: { name: string; status: string };
  }>,
): ActiveConflict[] {
  const set = new Set(requestedDnLineIds);
  return existingActiveRows
    .filter((r) => set.has(r.deliveryNoteItemId))
    .map((r) => ({
      deliveryNoteItemId: r.deliveryNoteItemId,
      existingPickListName: r.pickList.name,
      existingPickListStatus: r.pickList.status,
    }));
}
