import { describe, expect, it } from "vitest";
import { computeCommissions, validateAllocations } from "./deal-splits";

describe("validateAllocations", () => {
  it("empty rows are valid (empty = fallback to SI.salesPersonId)", () => {
    expect(validateAllocations([]).ok).toBe(true);
  });

  it("single row summing to 100 is valid", () => {
    expect(validateAllocations([{ salesPersonId: "sp1", allocationPct: 100 }]).ok).toBe(true);
  });

  it("even split across three at 33.333 % passes tolerance", () => {
    const r = validateAllocations([
      { salesPersonId: "sp1", allocationPct: 33.333 },
      { salesPersonId: "sp2", allocationPct: 33.333 },
      { salesPersonId: "sp3", allocationPct: 33.334 },
    ]);
    expect(r.ok).toBe(true);
  });

  it("fails when sum outside tolerance", () => {
    const r = validateAllocations([
      { salesPersonId: "sp1", allocationPct: 60 },
      { salesPersonId: "sp2", allocationPct: 30 },
    ]);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("sum to");
    expect(r.sum).toBe(90);
  });

  it("rejects negative or >100 allocationPct", () => {
    expect(validateAllocations([{ salesPersonId: "sp1", allocationPct: -5 }]).ok).toBe(false);
    expect(validateAllocations([{ salesPersonId: "sp1", allocationPct: 105 }]).ok).toBe(false);
  });

  it("rejects duplicate salesPersonId", () => {
    const r = validateAllocations([
      { salesPersonId: "sp1", allocationPct: 50 },
      { salesPersonId: "sp1", allocationPct: 50 },
    ]);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("Duplicate");
  });

  it("rejects commission rate outside 0..100", () => {
    expect(
      validateAllocations([{ salesPersonId: "sp1", allocationPct: 100, commissionRate: 150 }]).ok,
    ).toBe(false);
  });
});

describe("computeCommissions", () => {
  it("proportionally attributes revenue + applies commission rate", () => {
    const c = computeCommissions(
      [
        { salesPersonId: "sp1", allocationPct: 60, commissionRate: 5 },
        { salesPersonId: "sp2", allocationPct: 40, commissionRate: 10 },
      ],
      1000,
    );
    expect(c[0].attributedRevenue).toBe(600);
    expect(c[0].commissionAmount).toBe(30);
    expect(c[1].attributedRevenue).toBe(400);
    expect(c[1].commissionAmount).toBe(40);
  });

  it("defaults commission rate to zero when omitted", () => {
    const c = computeCommissions([{ salesPersonId: "sp1", allocationPct: 100 }], 500);
    expect(c[0].commissionAmount).toBe(0);
    expect(c[0].attributedRevenue).toBe(500);
  });
});
