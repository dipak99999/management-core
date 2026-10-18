import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { computeTaxLines, computeInvoiceTaxLines, type ResolvedTaxRow } from "./tax";

function row(
  description: string,
  rate: number,
  chargeType: ResolvedTaxRow["chargeType"] = "On Net Total",
  amount = 0,
): ResolvedTaxRow {
  return { description, rate, chargeType, amount, accountId: `acc-${description}` };
}

describe("computeTaxLines", () => {
  it("computes On Net Total lines", () => {
    const out = computeTaxLines(new Prisma.Decimal(1000), [row("GST", 18)]);
    expect(out).toHaveLength(1);
    expect(Number(out[0].taxAmount)).toBe(180);
  });

  it("cascades On Previous Row Total", () => {
    // netTotal 1000, GST 10% = 100, Cess 5% on (1000 + 100) = 55
    const out = computeTaxLines(new Prisma.Decimal(1000), [
      row("GST", 10),
      row("Cess", 5, "On Previous Row Total"),
    ]);
    expect(Number(out[0].taxAmount)).toBe(100);
    expect(Number(out[1].taxAmount)).toBe(55);
  });

  it("uses the row's flat amount for Actual charge type", () => {
    const out = computeTaxLines(new Prisma.Decimal(1000), [row("Delivery", 0, "Actual", 42)]);
    expect(Number(out[0].taxAmount)).toBe(42);
  });

  it("returns an empty array for no rows", () => {
    expect(computeTaxLines(new Prisma.Decimal(500), [])).toEqual([]);
  });
});

describe("computeInvoiceTaxLines", () => {
  it("aggregates per-line-template groups into unique tax rows", () => {
    const rowsA: ResolvedTaxRow[] = [row("GST", 18)];
    const rowsB: ResolvedTaxRow[] = [row("GST", 18)]; // same tax → aggregate
    const out = computeInvoiceTaxLines(
      [
        { amount: new Prisma.Decimal(1000), taxTemplateId: "A" },
        { amount: new Prisma.Decimal(500), taxTemplateId: "B" },
      ],
      null,
      (id) => (id === "A" ? rowsA : id === "B" ? rowsB : null),
    );
    // 1000 * 18% + 500 * 18% = 180 + 90 = 270 aggregated into one row
    expect(out).toHaveLength(1);
    expect(Number(out[0].taxAmount)).toBe(270);
  });

  it("falls back to invoice-level template for lines with no override", () => {
    const invRows: ResolvedTaxRow[] = [row("GST", 10)];
    const out = computeInvoiceTaxLines(
      [{ amount: new Prisma.Decimal(2000) }],
      "INV",
      (id) => (id === "INV" ? invRows : null),
    );
    expect(Number(out[0].taxAmount)).toBe(200);
  });
});
