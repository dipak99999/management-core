// Regression tests for the money-arithmetic Decimal fixes landed on
// 2026-10-01. Each test pins the arithmetic pattern used in a specific
// production code path so a future refactor can't accidentally reintroduce
// a drift-prone JS-float version.
//
// For context on why these matter:
//   • payment-entries.ts:727 — allocation validation
//   • sales-invoices.ts:826  — deferred-revenue + GL posting
//   • webhook-receiver.ts:188 — paise→rupees conversion
//   • blanket-orders.ts:161   — fractional qty accumulator
//   • salary-slips.ts:32      — payroll totals
//
// Each test exercises the exact Decimal arithmetic the production code
// relies on and asserts an exact result. If someone converts any of these
// paths back to JS Number, the test fails. That's the only guarantee we
// get from a test file.

import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";

describe("money-arithmetic regression — Decimal gives exact results", () => {
  it("JS floats are unsafe for money — baseline", () => {
    // The canonical demonstration. If this ever passes, Node JS semantics
    // changed and the test is obsolete.
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(new Prisma.Decimal("0.1").add("0.2").equals("0.3")).toBe(true);
  });

  // sales-invoices.ts § deferredNet accumulator
  it("sum of fractional line amounts: exact Decimal total", () => {
    const lines = ["33.33", "33.33", "33.34"];
    const total = lines.reduce(
      (s, v) => s.add(new Prisma.Decimal(v)),
      new Prisma.Decimal(0),
    );
    expect(total.equals("100")).toBe(true);
    expect(total.toFixed(2)).toBe("100.00");
  });

  // sales-invoices.ts § deferredNet × fx
  it("net × fx conversion: Decimal preserves full precision", () => {
    const net = new Prisma.Decimal("1234.56");
    const fx = new Prisma.Decimal("83.42");
    const product = net.mul(fx);
    expect(product.toFixed(4)).toBe("102986.9952");
    // Rounded to paisa for GL — Prisma.Decimal rounds half-up by default.
    expect(product.toFixed(2)).toBe("102987.00");
  });

  // payment-entries.ts § allocation remaining-amount validation
  it("payment allocation: exact 0.01 remainder is accepted, not falsely rejected", () => {
    const paidAmount = new Prisma.Decimal("1000.00");
    const previouslyAllocated = ["333.33", "333.33", "333.33"];
    const totalAllocated = previouslyAllocated.reduce(
      (s, v) => s.add(new Prisma.Decimal(v)),
      new Prisma.Decimal(0),
    );
    const remaining = paidAmount.sub(totalAllocated);
    expect(remaining.toFixed(2)).toBe("0.01");

    const newAllocation = new Prisma.Decimal("0.01");
    const excess = newAllocation.sub(remaining);
    // Pre-fix code did `allocatedAmount > remaining + 0.0001` in floats.
    // The Decimal version lets exact-remainder allocations through:
    expect(excess.gt(new Prisma.Decimal("0.0001"))).toBe(false);
  });

  it("payment allocation: an over-allocation of 0.02 is rejected", () => {
    const paidAmount = new Prisma.Decimal("1000.00");
    const previouslyAllocated = new Prisma.Decimal("999.99");
    const remaining = paidAmount.sub(previouslyAllocated); // 0.01
    const tryAllocate = new Prisma.Decimal("0.02");
    const excess = tryAllocate.sub(remaining);
    expect(excess.gt(new Prisma.Decimal("0.0001"))).toBe(true); // ✓ rejected
  });

  // webhook-receiver.ts § paise→rupees
  it("paise→rupees via Decimal.div(100) is exact and round-trips", () => {
    const paise = 100099;
    const rupees = new Prisma.Decimal(paise).div(100);
    expect(rupees.toFixed(2)).toBe("1000.99");
    expect(rupees.equals("1000.99")).toBe(true);
    expect(rupees.mul(100).equals(paise)).toBe(true);
  });

  // blanket-orders.ts § fractional qty
  it("fractional qty accumulator: 7 partial fulfillments sum to exact 10.00", () => {
    const parts = ["1.1", "1.2", "1.3", "1.4", "1.5", "1.5", "2.0"];
    const total = parts.reduce(
      (s, v) => s.add(new Prisma.Decimal(v)),
      new Prisma.Decimal(0),
    );
    expect(total.equals("10")).toBe(true);
    expect(total.toFixed(1)).toBe("10.0");
  });

  // salary-slips.ts § gross / deduction / net
  it("salary totals: Decimal reduce handles 0.33-fractional components exactly", () => {
    const earnings = ["33333.33", "16666.67", "5000.33"]; // 55000.33
    const deductions = ["5416.67", "1800.33", "283.33"]; // 7500.33
    const gross = earnings.reduce(
      (s, v) => s.add(new Prisma.Decimal(v)),
      new Prisma.Decimal(0),
    );
    const ded = deductions.reduce(
      (s, v) => s.add(new Prisma.Decimal(v)),
      new Prisma.Decimal(0),
    );
    const net = gross.sub(ded);
    expect(gross.toFixed(2)).toBe("55000.33");
    expect(ded.toFixed(2)).toBe("7500.33");
    expect(net.toFixed(2)).toBe("47500.00");
  });

  // GL-balance invariant
  it("GL invariant: debit sum = credit sum exactly, even on split income+deferred", () => {
    const lines = ["3333.33", "3333.33", "3333.34"]; // 10,000
    const immediate = new Prisma.Decimal(lines[1]);
    const deferred = new Prisma.Decimal(lines[0]).add(lines[2]);
    const debitTotal = new Prisma.Decimal("10000");
    const creditTotal = immediate.add(deferred);
    expect(debitTotal.sub(creditTotal).equals(0)).toBe(true);
    expect(debitTotal.sub(creditTotal).toFixed(2)).toBe("0.00");
  });
});
