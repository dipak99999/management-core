import { describe, expect, it } from "vitest";
import { findActiveConflicts, pickProgress, sortForPickWalk } from "./pick-list";

describe("sortForPickWalk", () => {
  it("groups by warehouse first, then by item within a warehouse", () => {
    const sorted = sortForPickWalk([
      { deliveryNoteItemId: "d1", itemId: "z-item", warehouseId: "w1", warehouseName: "B-shelf", qty: 5, batchNo: null, serialNos: [] },
      { deliveryNoteItemId: "d2", itemId: "a-item", warehouseId: "w2", warehouseName: "A-shelf", qty: 3, batchNo: null, serialNos: [] },
      { deliveryNoteItemId: "d3", itemId: "a-item", warehouseId: "w1", warehouseName: "B-shelf", qty: 2, batchNo: null, serialNos: [] },
    ]);
    // A-shelf first (w2), then B-shelf (w1) with items sorted a→z
    expect(sorted.map((r) => r.deliveryNoteItemId)).toEqual(["d2", "d3", "d1"]);
  });

  it("preserves batch/serial hints from source lines", () => {
    const sorted = sortForPickWalk([
      {
        deliveryNoteItemId: "d1",
        itemId: "i",
        warehouseId: "w",
        warehouseName: "A",
        qty: 1,
        batchNo: "BATCH-42",
        serialNos: ["SN-1", "SN-2"],
      },
    ]);
    expect(sorted[0].batchNo).toBe("BATCH-42");
    expect(sorted[0].serialNos).toEqual(["SN-1", "SN-2"]);
  });

  it("returns empty for empty input", () => {
    expect(sortForPickWalk([])).toEqual([]);
  });
});

describe("pickProgress", () => {
  it("returns 0 for no rows", () => {
    expect(pickProgress([])).toBe(0);
  });

  it("returns fraction of fully-picked rows", () => {
    expect(
      pickProgress([
        { qty: 5, pickedQty: 5 },
        { qty: 3, pickedQty: 3 },
        { qty: 2, pickedQty: 1 },
      ]),
    ).toBeCloseTo(2 / 3);
  });

  it("counts over-picked rows as done", () => {
    expect(pickProgress([{ qty: 5, pickedQty: 10 }])).toBe(1);
  });
});

describe("findActiveConflicts", () => {
  it("returns empty when no overlap", () => {
    const c = findActiveConflicts(
      ["d1", "d2"],
      [{ deliveryNoteItemId: "d3", pickList: { name: "PICK-1", status: "Submitted" } }],
    );
    expect(c).toEqual([]);
  });

  it("returns conflicts with the existing pick list's identity", () => {
    const c = findActiveConflicts(
      ["d1", "d2"],
      [
        { deliveryNoteItemId: "d1", pickList: { name: "PICK-1", status: "Submitted" } },
        { deliveryNoteItemId: "d9", pickList: { name: "PICK-2", status: "Submitted" } },
      ],
    );
    expect(c).toEqual([
      {
        deliveryNoteItemId: "d1",
        existingPickListName: "PICK-1",
        existingPickListStatus: "Submitted",
      },
    ]);
  });
});
