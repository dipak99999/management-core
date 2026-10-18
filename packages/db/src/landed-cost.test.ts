import { describe, expect, it } from "vitest";
import {
  allocateLandedCost,
  applyBumpToBin,
  type LandedCostItemInput,
  type LandedCostTaxInput,
} from "./landed-cost";

function line(over: Partial<LandedCostItemInput>): LandedCostItemInput {
  return {
    prName: "PR-1",
    itemId: "item-A",
    warehouseId: "wh-1",
    qty: 10,
    rate: 100,
    ...over,
  };
}
function tax(amount: number): LandedCostTaxInput {
  return { amount };
}

describe("allocateLandedCost", () => {
  it("empty items + zero taxes → empty result", () => {
    const r = allocateLandedCost([], []);
    expect(r.bumps).toEqual([]);
    expect(r.totalCost).toBe(0);
  });

  it("throws when items empty but taxes non-zero", () => {
    expect(() => allocateLandedCost([tax(500)], [])).toThrow(/no purchase-receipt/);
  });

  it("throws when total base is zero", () => {
    expect(() =>
      allocateLandedCost([tax(500)], [line({ qty: 0 })]),
    ).toThrow(/zero base value/);
  });

  it("single line → full cost bumps that bin", () => {
    const r = allocateLandedCost(
      [tax(500)],
      [line({ itemId: "A", warehouseId: "W1" })],
    );
    expect(r.totalCost).toBe(500);
    expect(r.bumps).toHaveLength(1);
    expect(r.bumps[0]).toEqual({ itemId: "A", warehouseId: "W1", addValue: 500 });
  });

  it("multi-line pro-rata by qty*rate weight", () => {
    // Line A: 10 * 100 = 1000 (66.67% of base)
    // Line B: 5  * 100 = 500  (33.33% of base)
    // Total tax: 300 → A gets 200, B gets 100.
    const r = allocateLandedCost(
      [tax(300)],
      [
        line({ itemId: "A", warehouseId: "W1", qty: 10, rate: 100 }),
        line({ itemId: "B", warehouseId: "W1", qty: 5, rate: 100 }),
      ],
    );
    expect(r.bumps[0]?.addValue).toBe(200);
    expect(r.bumps[1]?.addValue).toBe(100);
  });

  it("multiple tax rows aggregate", () => {
    const r = allocateLandedCost(
      [tax(100), tax(200), tax(50)],
      [line({})],
    );
    expect(r.totalCost).toBe(350);
    expect(r.bumps[0]?.addValue).toBe(350);
  });

  it("same (item, warehouse) across two PR lines collapses into ONE bump", () => {
    // Two PR lines for item-A in wh-1: quantities 6 and 4 → 60% + 40% share of tax
    const r = allocateLandedCost(
      [tax(1000)],
      [
        line({ prName: "PR-1", qty: 6, rate: 100 }),
        line({ prName: "PR-2", qty: 4, rate: 100 }),
      ],
    );
    expect(r.bumps).toHaveLength(1);
    expect(r.bumps[0]?.addValue).toBe(1000);
  });

  it("bump order matches first-occurrence order of keys", () => {
    const r = allocateLandedCost(
      [tax(300)],
      [
        line({ itemId: "B", warehouseId: "W1" }),
        line({ itemId: "A", warehouseId: "W1" }),
        line({ itemId: "B", warehouseId: "W1" }),
      ],
    );
    expect(r.bumps.map((b) => b.itemId)).toEqual(["B", "A"]);
  });

  it("sum-of-bumps === totalCost to the cent (last bump absorbs remainder)", () => {
    // 3 items with equal weight; tax = ₹100 → naive shares are 33.33, 33.33, 33.34
    const r = allocateLandedCost(
      [tax(100)],
      [
        line({ itemId: "A", warehouseId: "W1" }),
        line({ itemId: "B", warehouseId: "W1" }),
        line({ itemId: "C", warehouseId: "W1" }),
      ],
    );
    const sum = r.bumps.reduce((s, b) => s + b.addValue, 0);
    expect(Math.round(sum * 100) / 100).toBe(100);
  });

  it("sum-of-bumps === totalCost for pathological (7 items × ₹1000)", () => {
    // 7 items with equal weight → 142.857 each, sum drifts.
    const items = Array.from({ length: 7 }, (_, i) =>
      line({ itemId: `I${i}`, warehouseId: "W1" }),
    );
    const r = allocateLandedCost([tax(1000)], items);
    const sum = r.bumps.reduce((s, b) => s + b.addValue, 0);
    expect(Math.round(sum * 100) / 100).toBe(1000);
  });

  it("cross-warehouse split — same item in two warehouses gets two bumps", () => {
    const r = allocateLandedCost(
      [tax(500)],
      [
        line({ itemId: "A", warehouseId: "W1", qty: 5, rate: 100 }),
        line({ itemId: "A", warehouseId: "W2", qty: 5, rate: 100 }),
      ],
    );
    expect(r.bumps).toHaveLength(2);
    expect(r.bumps[0]?.warehouseId).toBe("W1");
    expect(r.bumps[1]?.warehouseId).toBe("W2");
    expect(r.bumps[0]?.addValue).toBe(250);
    expect(r.bumps[1]?.addValue).toBe(250);
  });
});

describe("applyBumpToBin", () => {
  it("adds addValue to stockValue and recomputes rate", () => {
    const r = applyBumpToBin(
      { stockValue: 1000, actualQty: 10 },
      { addValue: 200 },
    );
    expect(r.stockValue).toBe(1200);
    expect(r.valuationRate).toBe(120);
  });

  it("qty=0 → rate falls back to 0 (division guard)", () => {
    const r = applyBumpToBin({ stockValue: 500, actualQty: 0 }, { addValue: 100 });
    expect(r.stockValue).toBe(600);
    expect(r.valuationRate).toBe(0);
  });

  it("handles fractional bumps", () => {
    const r = applyBumpToBin(
      { stockValue: 100, actualQty: 3 },
      { addValue: 33.33 },
    );
    expect(r.stockValue).toBe(133.33);
    // 133.33 / 3 = 44.4433... → rounded to 4dp
    expect(r.valuationRate).toBe(44.4433);
  });
});
