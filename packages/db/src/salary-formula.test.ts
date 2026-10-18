import { describe, expect, it } from "vitest";
import { evalFormula, evaluateComponents } from "./salary-formula";

describe("evalFormula", () => {
  it("evaluates arithmetic", () => {
    expect(evalFormula("100 + 50", {})).toBe(150);
  });

  it("substitutes {Name} tokens from context", () => {
    expect(evalFormula("{Basic} * 0.1", { Basic: 20000 })).toBe(2000);
  });

  it("supports parentheses + multiple tokens", () => {
    expect(evalFormula("({Basic} + {HRA}) * 0.05", { Basic: 20000, HRA: 5000 })).toBe(1250);
  });

  it("throws on unknown component", () => {
    expect(() => evalFormula("{Basic} + 1", {})).toThrow(/unknown component/);
  });

  it("rejects unsafe expressions", () => {
    // Note: this string has no {} tokens, so substitution is a no-op and the
    // safe-expr regex catches the alphabetic characters.
    expect(() => evalFormula("process.exit(1)", {})).toThrow(/unsafe/);
  });

  it("rejects invalid regex-caught chars post-substitution", () => {
    expect(() => evalFormula("{a}; alert(1)", { a: 1 })).toThrow(/unsafe/);
  });
});

describe("evaluateComponents", () => {
  it("uses raw amount when formula is null", () => {
    const out = evaluateComponents([
      { componentName: "Basic", type: "Earning", amount: 25000, formula: null },
    ]);
    expect(out[0].amount).toBe(25000);
  });

  it("later formulas reference earlier computed values", () => {
    const out = evaluateComponents([
      { componentName: "Basic", type: "Earning", amount: 20000, formula: null },
      { componentName: "HRA", type: "Earning", amount: 0, formula: "{Basic} * 0.4" },
      { componentName: "PF", type: "Deduction", amount: 0, formula: "{Basic} * 0.12" },
    ]);
    expect(out.map((c) => c.amount)).toEqual([20000, 8000, 2400]);
  });

  it("rounds to 4 decimals", () => {
    const out = evaluateComponents([
      { componentName: "A", type: "Earning", amount: 0, formula: "10 / 3" },
    ]);
    expect(out[0].amount).toBe(3.3333);
  });
});
