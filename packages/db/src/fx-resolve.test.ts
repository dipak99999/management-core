import { describe, expect, it } from "vitest";
import { resolveRate } from "./fx-resolve";

// Build a stub db driven by a Map<pair, {rate, effectiveDate, source}[]>.
function stubDb(rows: Array<{ from: string; to: string; rate: number; date: string; source?: string }>) {
  const parsed = rows.map((r) => ({
    fromCurrency: r.from,
    toCurrency: r.to,
    effectiveDate: new Date(r.date),
    rate: r.rate,
    source: r.source ?? "Manual",
  }));
  return {
    exchangeRate: {
      findFirst: async (args: any) => {
        const w = args.where;
        const match = parsed
          .filter((p) => p.fromCurrency === w.fromCurrency && p.toCurrency === w.toCurrency && p.effectiveDate <= w.effectiveDate.lte)
          .sort((a, b) => b.effectiveDate.getTime() - a.effectiveDate.getTime())[0];
        return match ?? null;
      },
    },
  };
}

describe("resolveRate", () => {
  const asOf = new Date("2026-06-30");

  it("returns 1 for identity pair", async () => {
    const db = stubDb([]);
    const r = await resolveRate(db, "t1", "USD", "USD", asOf);
    expect(r).toEqual({ rate: 1, source: "identity" });
  });

  it("resolves direct pair", async () => {
    const db = stubDb([{ from: "USD", to: "INR", rate: 83, date: "2026-06-01" }]);
    const r = await resolveRate(db, "t1", "USD", "INR", asOf);
    expect(r?.rate).toBe(83);
    expect(r?.source).toBe("Manual");
  });

  it("falls back to inverse pair", async () => {
    const db = stubDb([{ from: "INR", to: "USD", rate: 1 / 83, date: "2026-06-01" }]);
    const r = await resolveRate(db, "t1", "USD", "INR", asOf);
    expect(r?.rate).toBeCloseTo(83);
    expect(r?.source).toContain("inverse of");
  });

  it("triangulates via USD when direct + inverse missing", async () => {
    const db = stubDb([
      { from: "EUR", to: "USD", rate: 1.1, date: "2026-06-01" },
      { from: "USD", to: "INR", rate: 83, date: "2026-06-01" },
    ]);
    const r = await resolveRate(db, "t1", "EUR", "INR", asOf);
    expect(r?.rate).toBeCloseTo(1.1 * 83);
    expect(r?.source).toContain("triangle via USD");
  });

  it("returns null when triangle legs are missing", async () => {
    const db = stubDb([{ from: "EUR", to: "USD", rate: 1.1, date: "2026-06-01" }]);
    const r = await resolveRate(db, "t1", "EUR", "INR", asOf);
    expect(r).toBeNull();
  });

  it("does not triangle when from or to already equals intermediate", async () => {
    const db = stubDb([]);
    const r = await resolveRate(db, "t1", "USD", "INR", asOf);
    expect(r).toBeNull();
  });
});
