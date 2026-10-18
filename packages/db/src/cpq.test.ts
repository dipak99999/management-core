import { describe, expect, it } from "vitest";
import { computeCpqQuote, type CpqConfig } from "./cpq";

const config: CpqConfig = {
  questions: [
    { key: "color", label: "Color", options: ["Red", "Blue"], required: true },
    { key: "size", label: "Size", options: ["S", "M", "L"], required: true },
    { key: "engrave", label: "Engraving", type: "boolean" },
  ],
  priceRules: [
    { when: { engrave: true }, adjust: { type: "flat", amount: 500 }, label: "Engraving fee" },
    { when: { size: "L" }, adjust: { type: "pct", percent: 10 }, label: "Large surcharge (10%)" },
  ],
  attributeMap: { color: "Color", size: "Size" },
};

describe("computeCpqQuote", () => {
  it("base only when no rules match", () => {
    const r = computeCpqQuote({ basePrice: 1000, answers: { color: "Red", size: "M" }, config });
    expect(r.ok).toBe(true);
    expect(r.total).toBe(1000);
    expect(r.lines).toHaveLength(1);
  });

  it("adds a flat rule when it matches", () => {
    const r = computeCpqQuote({ basePrice: 1000, answers: { color: "Red", size: "M", engrave: true }, config });
    expect(r.total).toBe(1500);
    expect(r.lines[1].label).toBe("Engraving fee");
    expect(r.lines[1].amount).toBe(500);
  });

  it("applies pct rule on running subtotal, in rule order", () => {
    const r = computeCpqQuote({ basePrice: 1000, answers: { color: "Red", size: "L", engrave: true }, config });
    // 1000 + 500 (flat) = 1500 → +10% = 1650
    expect(r.total).toBe(1650);
    expect(r.lines).toHaveLength(3);
  });

  it("reports missing required questions", () => {
    const r = computeCpqQuote({ basePrice: 1000, answers: { color: "Red" }, config });
    expect(r.ok).toBe(false);
    expect(r.missingRequired).toEqual(["size"]);
  });

  it("emits variantAttributes from attributeMap", () => {
    const r = computeCpqQuote({ basePrice: 1000, answers: { color: "Blue", size: "S" }, config });
    expect(r.variantAttributes).toEqual({ Color: "Blue", Size: "S" });
  });

  it("skips a rule whose condition isn't satisfied", () => {
    const r = computeCpqQuote({ basePrice: 1000, answers: { color: "Red", size: "S", engrave: false }, config });
    expect(r.total).toBe(1000);
  });
});
