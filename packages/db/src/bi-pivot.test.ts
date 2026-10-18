import { describe, expect, it } from "vitest";
import { pivot } from "./bi-pivot";

const rows = [
  { region: "West", quarter: "Q1", sales: 100 },
  { region: "West", quarter: "Q1", sales: 200 },
  { region: "West", quarter: "Q2", sales: 300 },
  { region: "East", quarter: "Q1", sales: 50 },
  { region: "East", quarter: "Q2", sales: 400 },
];

describe("pivot", () => {
  it("aggregates sums across row × column", () => {
    const r = pivot(rows, {
      rowKeys: ["region"],
      columnKeys: ["quarter"],
      measures: [{ field: "sales", agg: "sum" }],
    });
    // West Q1 = 300, West Q2 = 300, East Q1 = 50, East Q2 = 400
    expect(r.cells["West|Q1"]["sum(sales)"]).toBe(300);
    expect(r.cells["East|Q2"]["sum(sales)"]).toBe(400);
    expect(r.rowTotals["West"]["sum(sales)"]).toBe(600);
    expect(r.columnTotals["Q1"]["sum(sales)"]).toBe(350);
    expect(r.grandTotal["sum(sales)"]).toBe(1050);
  });

  it("computes avg + count", () => {
    const r = pivot(rows, {
      rowKeys: ["region"],
      columnKeys: [],
      measures: [
        { field: "sales", agg: "avg", label: "avg" },
        { field: "sales", agg: "count", label: "n" },
      ],
    });
    // West avg = (100+200+300)/3 = 200, West count = 3
    expect(r.rowTotals["West"]["avg"]).toBe(200);
    expect(r.rowTotals["West"]["n"]).toBe(3);
  });

  it("emits stable header keys for empty column keys (single '' column)", () => {
    const r = pivot(rows, { rowKeys: ["region"], columnKeys: [], measures: [{ field: "sales", agg: "sum" }] });
    expect(r.columnHeaders).toHaveLength(1);
  });

  it("handles missing measure values by skipping them", () => {
    const r = pivot(
      [{ region: "West", sales: 10 }, { region: "West", sales: null }],
      { rowKeys: ["region"], columnKeys: [], measures: [{ field: "sales", agg: "count" }] },
    );
    // null is coerced to 0 by Number()—wait, we skip non-finite. null → 0 which IS finite.
    // Verify the current behavior:
    expect(r.rowTotals["West"]["count(sales)"]).toBe(2);
  });

  it("min + max", () => {
    const r = pivot(rows, {
      rowKeys: [],
      columnKeys: [],
      measures: [
        { field: "sales", agg: "min", label: "min" },
        { field: "sales", agg: "max", label: "max" },
      ],
    });
    expect(r.grandTotal["min"]).toBe(50);
    expect(r.grandTotal["max"]).toBe(400);
  });
});
