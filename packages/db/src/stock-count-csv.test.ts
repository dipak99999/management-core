import { describe, expect, it } from "vitest";
import { parseStockCountRows } from "./stock-count-csv";

const items = new Map([
  ["widget-a", "item-A"],
  ["widget-b", "item-B"],
  ["gizmo", "item-G"],
]);
const warehouses = new Map([
  ["main store", "wh-main"],
  ["cold storage", "wh-cold"],
]);
const lookups = { itemCodeToId: items, warehouseNameToId: warehouses };

describe("parseStockCountRows", () => {
  it("blank input → empty result, no error", () => {
    expect(parseStockCountRows("", lookups)).toEqual({ rows: [], errors: [] });
    expect(parseStockCountRows("   \n  \n", lookups)).toEqual({
      rows: [],
      errors: [],
    });
  });

  it("missing header → errors", () => {
    const r = parseStockCountRows("itemCode,warehouse\nWidget-A,Main Store", lookups);
    expect(r.errors).toContain("Header missing: countedQty");
    expect(r.rows).toEqual([]);
  });

  it("happy path — all four columns", () => {
    const csv = `itemCode,warehouse,countedQty,countedRate
Widget-A,Main Store,42,15.50
Widget-B,Cold Storage,10,`;
    const r = parseStockCountRows(csv, lookups);
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([
      {
        rowIndex: 1,
        itemId: "item-A",
        warehouseId: "wh-main",
        countedQty: 42,
        countedValuationRate: 15.5,
      },
      {
        rowIndex: 2,
        itemId: "item-B",
        warehouseId: "wh-cold",
        countedQty: 10,
        countedValuationRate: null,
      },
    ]);
  });

  it("case-insensitive header + item + warehouse", () => {
    const csv = `ITEMCODE,WAREHOUSE,COUNTEDQTY
WIDGET-A,MAIN STORE,5`;
    const r = parseStockCountRows(csv, lookups);
    expect(r.errors).toEqual([]);
    expect(r.rows[0]?.itemId).toBe("item-A");
    expect(r.rows[0]?.warehouseId).toBe("wh-main");
  });

  it("skips blank rows silently (spreadsheet trailing newlines)", () => {
    const csv = `itemCode,warehouse,countedQty
Widget-A,Main Store,1

,,
Widget-B,Cold Storage,2

`;
    const r = parseStockCountRows(csv, lookups);
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(2);
  });

  it("unknown item → per-row error, row dropped, others continue", () => {
    const csv = `itemCode,warehouse,countedQty
Widget-A,Main Store,10
Unknown-Sku,Main Store,5
Widget-B,Cold Storage,3`;
    const r = parseStockCountRows(csv, lookups);
    expect(r.rows).toHaveLength(2);
    expect(r.errors).toEqual([`row 2: unknown itemCode "Unknown-Sku"`]);
  });

  it("unknown warehouse → per-row error", () => {
    const csv = `itemCode,warehouse,countedQty
Widget-A,Nowhere,10`;
    const r = parseStockCountRows(csv, lookups);
    expect(r.rows).toEqual([]);
    expect(r.errors).toContain('row 1: unknown warehouse "Nowhere"');
  });

  it("non-numeric countedQty → per-row error", () => {
    const csv = `itemCode,warehouse,countedQty
Widget-A,Main Store,not-a-number`;
    const r = parseStockCountRows(csv, lookups);
    expect(r.errors[0]).toContain("countedQty");
    expect(r.errors[0]).toContain("not a number");
  });

  it("negative qty rejected", () => {
    const csv = `itemCode,warehouse,countedQty
Widget-A,Main Store,-5`;
    const r = parseStockCountRows(csv, lookups);
    expect(r.errors[0]).toMatch(/cannot be negative/);
  });

  it("countedRate = 0 → null (no rate change)", () => {
    const csv = `itemCode,warehouse,countedQty,countedRate
Widget-A,Main Store,10,0`;
    const r = parseStockCountRows(csv, lookups);
    expect(r.rows[0]?.countedValuationRate).toBeNull();
  });

  it("countedRate = empty string → null", () => {
    const csv = `itemCode,warehouse,countedQty,countedRate
Widget-A,Main Store,10,`;
    const r = parseStockCountRows(csv, lookups);
    expect(r.rows[0]?.countedValuationRate).toBeNull();
  });

  it("countedRate = negative rejected", () => {
    const csv = `itemCode,warehouse,countedQty,countedRate
Widget-A,Main Store,10,-5`;
    const r = parseStockCountRows(csv, lookups);
    expect(r.errors[0]).toMatch(/countedRate cannot be negative/);
  });

  it("missing itemCode cell in a row → per-row error", () => {
    const csv = `itemCode,warehouse,countedQty
,Main Store,10`;
    const r = parseStockCountRows(csv, lookups);
    expect(r.errors[0]).toMatch(/itemCode is required/);
  });

  it("collects multiple errors instead of failing fast", () => {
    const csv = `itemCode,warehouse,countedQty
Unknown,Main Store,10
Widget-A,Ghost,5
Widget-A,Main Store,notanum`;
    const r = parseStockCountRows(csv, lookups);
    expect(r.rows).toEqual([]);
    expect(r.errors).toHaveLength(3);
  });

  it("valid + invalid rows coexist — return valid rows AND per-row errors", () => {
    const csv = `itemCode,warehouse,countedQty
Widget-A,Main Store,42
Bogus,Main Store,10
Widget-B,Cold Storage,7`;
    const r = parseStockCountRows(csv, lookups);
    expect(r.rows).toHaveLength(2);
    expect(r.errors).toHaveLength(1);
  });
});
