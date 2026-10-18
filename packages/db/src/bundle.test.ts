import { describe, expect, it } from "vitest";
import {
  expandBundleLine,
  expandBundleLines,
  validateBundleDefinition,
  type BundleDefLike,
} from "./bundle";

// ---------------------------------------------------------------------
// validateBundleDefinition

describe("validateBundleDefinition", () => {
  it("passes a plausible bundle (multiple components, positive qty)", () => {
    const err = validateBundleDefinition({
      parentItemId: "GIFT-BASKET",
      components: [
        { componentItemId: "CHOC-A", qty: 3 },
        { componentItemId: "CHOC-B", qty: 2 },
        { componentItemId: "CARD", qty: 1 },
      ],
    });
    expect(err).toBeNull();
  });

  it("rejects an empty component list", () => {
    const err = validateBundleDefinition({
      parentItemId: "GIFT-BASKET",
      components: [],
    });
    expect(err).toMatch(/at least one component/);
  });

  it("rejects self-reference (parent listed as its own component)", () => {
    const err = validateBundleDefinition({
      parentItemId: "GIFT-BASKET",
      components: [{ componentItemId: "GIFT-BASKET", qty: 1 }],
    });
    expect(err).toMatch(/itself as a component/);
  });

  it("rejects duplicate componentItemId (unique index would catch DB-side too)", () => {
    const err = validateBundleDefinition({
      parentItemId: "GIFT-BASKET",
      components: [
        { componentItemId: "CHOC-A", qty: 3 },
        { componentItemId: "CHOC-A", qty: 2 },
      ],
    });
    expect(err).toMatch(/more than once/);
    // Message should hint at the fix, not just report the error.
    expect(err).toMatch(/bump its qty/);
  });

  it("rejects a zero or negative component qty", () => {
    for (const bad of [0, -1, -0.5]) {
      const err = validateBundleDefinition({
        parentItemId: "GIFT-BASKET",
        components: [{ componentItemId: "CHOC-A", qty: bad }],
      });
      expect(err).toMatch(/qty must be > 0/);
    }
  });
});

// ---------------------------------------------------------------------
// expandBundleLine

const basket: BundleDefLike = {
  parentItemId: "GIFT-BASKET",
  components: [
    { componentItemId: "CHOC-A", qty: 3, sortOrder: 1 },
    { componentItemId: "CHOC-B", qty: 2, sortOrder: 2 },
    { componentItemId: "CARD", qty: 1, sortOrder: 3 },
  ],
};

describe("expandBundleLine", () => {
  it("emits one row per component with qty = SO qty × component qty", () => {
    const out = expandBundleLine(
      { id: "so-line-1", itemId: "GIFT-BASKET", qty: 4 },
      basket,
    );
    // 4 baskets × (3 CHOC-A, 2 CHOC-B, 1 CARD) = 12 / 8 / 4
    expect(out).toEqual([
      { itemId: "CHOC-A", qty: 12, salesOrderItemId: "so-line-1" },
      { itemId: "CHOC-B", qty: 8, salesOrderItemId: "so-line-1" },
      { itemId: "CARD", qty: 4, salesOrderItemId: "so-line-1" },
    ]);
  });

  it("respects sortOrder (null sorts last)", () => {
    const out = expandBundleLine(
      { id: "so-line-1", itemId: "GIFT-BASKET", qty: 1 },
      {
        parentItemId: "GIFT-BASKET",
        components: [
          { componentItemId: "LAST", qty: 1, sortOrder: null },
          { componentItemId: "FIRST", qty: 1, sortOrder: 1 },
          { componentItemId: "SECOND", qty: 1, sortOrder: 2 },
        ],
      },
    );
    expect(out.map((r) => r.itemId)).toEqual(["FIRST", "SECOND", "LAST"]);
  });

  it("preserves salesOrderItemId on every emitted line (audit trail intact)", () => {
    const out = expandBundleLine(
      { id: "audit-me", itemId: "GIFT-BASKET", qty: 1 },
      basket,
    );
    expect(out.every((r) => r.salesOrderItemId === "audit-me")).toBe(true);
  });
});

// ---------------------------------------------------------------------
// expandBundleLines — mixed SO with some bundle + some regular lines

describe("expandBundleLines", () => {
  const bundleDefs = new Map([["GIFT-BASKET", basket]]);
  const warehouseFor = (_id: string) => "WH-MAIN";

  it("passes non-bundle lines through unchanged", () => {
    const out = expandBundleLines(
      [{ id: "so-1", itemId: "WIDGET", qty: 5 }],
      bundleDefs,
      warehouseFor,
    );
    expect(out).toEqual([
      { itemId: "WIDGET", qty: 5, warehouseId: "WH-MAIN", salesOrderItemId: "so-1" },
    ]);
  });

  it("expands bundle lines while leaving regular lines intact (mixed cart)", () => {
    const out = expandBundleLines(
      [
        { id: "so-1", itemId: "WIDGET", qty: 5 },
        { id: "so-2", itemId: "GIFT-BASKET", qty: 2 },
      ],
      bundleDefs,
      warehouseFor,
    );
    // WIDGET (1 line) + GIFT-BASKET (3 components) = 4 DN rows.
    expect(out).toHaveLength(4);
    expect(out[0].itemId).toBe("WIDGET");
    expect(out.slice(1).map((r) => r.itemId)).toEqual(["CHOC-A", "CHOC-B", "CARD"]);
    // qty math on the expanded bundle: 2 baskets × (3, 2, 1) = 6, 4, 2
    expect(out.slice(1).map((r) => r.qty)).toEqual([6, 4, 2]);
  });

  it("resolveWarehouse is called with each expanded line's itemId (per-item override possible)", () => {
    const calls: string[] = [];
    const out = expandBundleLines(
      [{ id: "so-1", itemId: "GIFT-BASKET", qty: 1 }],
      bundleDefs,
      (id) => {
        calls.push(id);
        return `WH-${id}`;
      },
    );
    expect(calls).toEqual(["CHOC-A", "CHOC-B", "CARD"]);
    expect(out.map((r) => r.warehouseId)).toEqual(["WH-CHOC-A", "WH-CHOC-B", "WH-CARD"]);
  });
});
