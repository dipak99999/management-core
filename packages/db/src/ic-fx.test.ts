import { describe, expect, it } from "vitest";
import { buildFromLines, buildToLines, computeICSide } from "./ic-fx";

describe("computeICSide", () => {
  it("returns identity numbers when rate=1 and no native override", () => {
    const r = computeICSide(1000, { currency: "INR", conversionRate: 1 });
    expect(r.nativeAmount).toBe(1000);
    expect(r.cashBase).toBe(1000);
    expect(r.fxDelta).toBe(0);
  });

  it("derives nativeAmount from base when omitted", () => {
    const r = computeICSide(8200, { currency: "USD", conversionRate: 82 });
    expect(r.nativeAmount).toBeCloseTo(100, 5);
    expect(r.cashBase).toBeCloseTo(8200, 5);
    expect(r.fxDelta).toBeCloseTo(0, 5);
  });

  it("recognizes an FX gain when native*rate > base amount", () => {
    // User pinned nativeAmount=100 USD at rate 83; base amount was 8200 INR.
    // cashBase = 100 * 83 = 8300; delta = 8300 - 8200 = 100.
    const r = computeICSide(8200, {
      currency: "USD",
      conversionRate: 83,
      nativeAmount: 100,
    });
    expect(r.cashBase).toBe(8300);
    expect(r.fxDelta).toBe(100);
  });

  it("recognizes an FX loss when native*rate < base amount", () => {
    const r = computeICSide(8200, {
      currency: "USD",
      conversionRate: 81,
      nativeAmount: 100,
    });
    expect(r.cashBase).toBe(8100);
    expect(r.fxDelta).toBe(-100);
  });
});

describe("buildFromLines", () => {
  it("returns 2 lines when no FX (delta=0)", () => {
    const lines = buildFromLines({
      amount: 1000,
      fxDelta: 0,
      cashBase: 1000,
      icAccountId: "ic",
      cashAccountId: "cash",
      fxAccountId: null,
    });
    expect(lines).toEqual([
      { accountId: "ic", debit: 1000, credit: 0 },
      { accountId: "cash", debit: 0, credit: 1000 },
    ]);
  });

  it("adds a DR fx line when cashBase > amount (from-side loss)", () => {
    const lines = buildFromLines({
      amount: 8200,
      fxDelta: 100,
      cashBase: 8300,
      icAccountId: "ic",
      cashAccountId: "cash",
      fxAccountId: "fx",
    });
    expect(lines).toHaveLength(3);
    expect(lines[2]).toEqual({ accountId: "fx", debit: 100, credit: 0 });
    // Balance check.
    const dr = lines.reduce((s, l) => s + l.debit, 0);
    const cr = lines.reduce((s, l) => s + l.credit, 0);
    expect(dr).toBe(cr);
  });

  it("adds a CR fx line when cashBase < amount (from-side gain)", () => {
    const lines = buildFromLines({
      amount: 8200,
      fxDelta: -100,
      cashBase: 8100,
      icAccountId: "ic",
      cashAccountId: "cash",
      fxAccountId: "fx",
    });
    expect(lines).toHaveLength(3);
    expect(lines[2]).toEqual({ accountId: "fx", debit: 0, credit: 100 });
    const dr = lines.reduce((s, l) => s + l.debit, 0);
    const cr = lines.reduce((s, l) => s + l.credit, 0);
    expect(dr).toBe(cr);
  });

  it("throws when FX residual exists but no fxAccountId is provided", () => {
    expect(() =>
      buildFromLines({
        amount: 8200,
        fxDelta: 100,
        cashBase: 8300,
        icAccountId: "ic",
        cashAccountId: "cash",
        fxAccountId: null,
      }),
    ).toThrow(/FX gain\/loss account required/);
  });
});

describe("buildToLines", () => {
  it("returns 2 lines when no FX (delta=0)", () => {
    const lines = buildToLines({
      amount: 1000,
      fxDelta: 0,
      cashBase: 1000,
      icAccountId: "ic",
      cashAccountId: "cash",
      fxAccountId: null,
    });
    expect(lines).toEqual([
      { accountId: "cash", debit: 1000, credit: 0 },
      { accountId: "ic", debit: 0, credit: 1000 },
    ]);
  });

  it("adds a CR fx line when cashBase > amount (to-side gain)", () => {
    const lines = buildToLines({
      amount: 8200,
      fxDelta: 100,
      cashBase: 8300,
      icAccountId: "ic",
      cashAccountId: "cash",
      fxAccountId: "fx",
    });
    expect(lines).toHaveLength(3);
    expect(lines[2]).toEqual({ accountId: "fx", debit: 0, credit: 100 });
    const dr = lines.reduce((s, l) => s + l.debit, 0);
    const cr = lines.reduce((s, l) => s + l.credit, 0);
    expect(dr).toBe(cr);
  });

  it("adds a DR fx line when cashBase < amount (to-side loss)", () => {
    const lines = buildToLines({
      amount: 8200,
      fxDelta: -100,
      cashBase: 8100,
      icAccountId: "ic",
      cashAccountId: "cash",
      fxAccountId: "fx",
    });
    expect(lines).toHaveLength(3);
    expect(lines[2]).toEqual({ accountId: "fx", debit: 100, credit: 0 });
    const dr = lines.reduce((s, l) => s + l.debit, 0);
    const cr = lines.reduce((s, l) => s + l.credit, 0);
    expect(dr).toBe(cr);
  });
});
