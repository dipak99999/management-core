import { describe, expect, it } from "vitest";
import { computeAdvanceReturn } from "./advance-return";

describe("computeAdvanceReturn", () => {
  it("no paidAmount → reject", () => {
    const r = computeAdvanceReturn({
      paidAmount: 0,
      existingReturnAmount: 0,
      requestedReturn: 100,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/no paid amount/);
  });

  it("zero request → reject", () => {
    const r = computeAdvanceReturn({
      paidAmount: 1000,
      existingReturnAmount: 0,
      requestedReturn: 0,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/must be > 0/);
  });

  it("negative request → reject", () => {
    const r = computeAdvanceReturn({
      paidAmount: 1000,
      existingReturnAmount: 0,
      requestedReturn: -50,
    });
    expect(r.ok).toBe(false);
  });

  it("full return, first return → ok + fullyReturned", () => {
    const r = computeAdvanceReturn({
      paidAmount: 1000,
      existingReturnAmount: 0,
      requestedReturn: 1000,
    });
    expect(r.ok).toBe(true);
    expect(r.newReturnAmount).toBe(1000);
    expect(r.remaining).toBe(0);
    expect(r.fullyReturned).toBe(true);
  });

  it("partial return, first return → ok + remaining reported", () => {
    const r = computeAdvanceReturn({
      paidAmount: 1000,
      existingReturnAmount: 0,
      requestedReturn: 300,
    });
    expect(r.ok).toBe(true);
    expect(r.newReturnAmount).toBe(300);
    expect(r.remaining).toBe(700);
    expect(r.fullyReturned).toBe(false);
  });

  it("second partial return → additive", () => {
    const r = computeAdvanceReturn({
      paidAmount: 1000,
      existingReturnAmount: 300,
      requestedReturn: 200,
    });
    expect(r.ok).toBe(true);
    expect(r.newReturnAmount).toBe(500);
    expect(r.remaining).toBe(500);
  });

  it("returning the exact remaining → fullyReturned", () => {
    const r = computeAdvanceReturn({
      paidAmount: 1000,
      existingReturnAmount: 700,
      requestedReturn: 300,
    });
    expect(r.ok).toBe(true);
    expect(r.newReturnAmount).toBe(1000);
    expect(r.remaining).toBe(0);
    expect(r.fullyReturned).toBe(true);
  });

  it("over-return → reject with remaining in message", () => {
    const r = computeAdvanceReturn({
      paidAmount: 1000,
      existingReturnAmount: 700,
      requestedReturn: 500,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("300");
  });

  it("float noise tolerated (100.00 return of 100.00 paid does not flip to over-return)", () => {
    // Simulate cumulative floating drift — 0.1 + 0.2 = 0.30000000000000004
    // Ensure a return of the "same" number still classifies as valid.
    const r = computeAdvanceReturn({
      paidAmount: 100,
      existingReturnAmount: 0,
      requestedReturn: 100.00000001,
    });
    expect(r.ok).toBe(true);
    expect(r.fullyReturned).toBe(true);
  });
});
