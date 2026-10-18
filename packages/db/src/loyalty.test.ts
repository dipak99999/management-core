import { describe, expect, it } from "vitest";
import {
  computeLoyaltyBalance,
  computeLoyaltyDiscount,
  computePointsEarned,
  expiredEntryPayload,
  findExpiredUnprocessed,
  findExpiringSoon,
  quoteRedemption,
  sumRedeemedPoints,
  type LoyaltyEntryLike,
  type LoyaltyProgramLike,
} from "./loyalty";

function earned(points: number, opts: { expiryDate?: Date | null; id?: string } = {}): LoyaltyEntryLike {
  return {
    id: opts.id ?? "e",
    entryType: "Earned",
    points,
    expiryDate: opts.expiryDate === undefined ? null : opts.expiryDate,
    postingDate: new Date("2026-01-01"),
  };
}

function redeemed(points: number): LoyaltyEntryLike {
  return { entryType: "Redeemed", points, postingDate: new Date("2026-02-01"), expiryDate: null };
}

function expired(points: number): LoyaltyEntryLike {
  return { entryType: "Expired", points, postingDate: new Date("2026-03-01"), expiryDate: null };
}

const defaultProgram: LoyaltyProgramLike = {
  minRedemptionPoints: 100,
  maxRedemptionPercent: 50,
  pointsPerCurrency: 0.01, // ₹100 = 1 point → ₹1 = 100 points-value... wait: pointsPerCurrency=0.01 means 1 currency yields 0.01 points → 100 points = 1 currency-value. So each point = ₹100. Hmm let me re-check.
  expiryMonths: 24,
  enabled: true,
};
// pointsPerCurrency = 0.01 → 1 point per 100 currency spent (earn direction)
// invert for redemption: 1 point = 1 / 0.01 = 100 currency. Which means
// redeeming 100 points → ₹10000. That's very generous but matches the schema.
// Tests below use those numbers directly.

describe("computeLoyaltyBalance", () => {
  it("empty → 0", () => {
    expect(computeLoyaltyBalance([])).toBe(0);
  });
  it("sums Earned entries", () => {
    expect(computeLoyaltyBalance([earned(50), earned(70)])).toBe(120);
  });
  it("Redeemed subtracts", () => {
    expect(computeLoyaltyBalance([earned(100), redeemed(40)])).toBe(60);
  });
  it("Expired subtracts", () => {
    expect(computeLoyaltyBalance([earned(100), expired(30)])).toBe(70);
  });
  it("Earned rows past expiryDate are NOT counted (belt-and-braces before scheduler runs)", () => {
    const stale = earned(100, { expiryDate: new Date("2026-01-01") });
    expect(computeLoyaltyBalance([stale], new Date("2026-06-01"))).toBe(0);
  });
  it("Earned rows with no expiryDate always count", () => {
    expect(computeLoyaltyBalance([earned(50, { expiryDate: null })])).toBe(50);
  });
  it("Earned rows expiring later than asOf still count", () => {
    const future = earned(100, { expiryDate: new Date("2027-06-01") });
    expect(computeLoyaltyBalance([future], new Date("2026-06-01"))).toBe(100);
  });
  it("floored at 0 when ledger is negative", () => {
    expect(computeLoyaltyBalance([earned(10), redeemed(50)])).toBe(0);
  });
});

describe("findExpiringSoon", () => {
  const asOf = new Date("2026-06-01");
  it("catches rows expiring within the window", () => {
    const soon = earned(100, { expiryDate: new Date("2026-07-01") });
    const later = earned(50, { expiryDate: new Date("2027-01-01") });
    expect(findExpiringSoon([soon, later], asOf, 90)).toEqual([soon]);
  });
  it("excludes already-expired rows (they've expired, not expiring)", () => {
    const gone = earned(100, { expiryDate: new Date("2026-05-01") });
    expect(findExpiringSoon([gone], asOf, 90)).toEqual([]);
  });
  it("excludes Redeemed/Expired types", () => {
    expect(findExpiringSoon([redeemed(50), expired(20)], asOf, 90)).toEqual([]);
  });
  it("excludes Earned rows with null expiryDate", () => {
    expect(findExpiringSoon([earned(50, { expiryDate: null })], asOf, 90)).toEqual([]);
  });
});

describe("findExpiredUnprocessed", () => {
  const asOf = new Date("2026-06-01");
  it("returns Earned rows past expiry", () => {
    const stale = earned(100, { expiryDate: new Date("2026-05-15"), id: "stale" });
    const fresh = earned(50, { expiryDate: new Date("2026-07-15"), id: "fresh" });
    const result = findExpiredUnprocessed([stale, fresh], asOf);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("stale");
  });
  it("excludes Earned rows with no expiryDate", () => {
    expect(findExpiredUnprocessed([earned(50, { expiryDate: null })], asOf)).toEqual([]);
  });
});

describe("expiredEntryPayload", () => {
  it("stamps the source id into remarks", () => {
    const src = earned(75, { expiryDate: new Date("2026-05-15"), id: "src-1" });
    const p = expiredEntryPayload({ ...src, id: "src-1" });
    expect(p.entryType).toBe("Expired");
    expect(p.points).toBe(75);
    expect(p.postingDate.toISOString()).toBe("2026-05-15T00:00:00.000Z");
    expect(p.remarks).toContain("src-1");
  });
});

describe("quoteRedemption", () => {
  it("disabled program → reject", () => {
    const q = quoteRedemption({
      requestedPoints: 200,
      balance: 500,
      program: { ...defaultProgram, enabled: false },
      invoiceTotal: 1_000_000,
    });
    expect(q.ok).toBe(false);
    expect(q.reason).toMatch(/disabled/);
  });
  it("requestedPoints < min → reject with reason", () => {
    const q = quoteRedemption({
      requestedPoints: 50,
      balance: 500,
      program: defaultProgram,
      invoiceTotal: 1_000_000,
    });
    expect(q.ok).toBe(false);
    expect(q.reason).toMatch(/Minimum/);
  });
  it("requestedPoints > balance → reject", () => {
    const q = quoteRedemption({
      requestedPoints: 600,
      balance: 500,
      program: defaultProgram,
      invoiceTotal: 1_000_000,
    });
    expect(q.ok).toBe(false);
    expect(q.reason).toMatch(/available/);
  });
  it("<= maxPct → returns exact requested", () => {
    // pointsPerCurrency=0.01 → 200 points = ₹20000. Cap = 50% of 100000 = 50000. Fits.
    const q = quoteRedemption({
      requestedPoints: 200,
      balance: 500,
      program: defaultProgram,
      invoiceTotal: 100_000,
    });
    expect(q.ok).toBe(true);
    expect(q.pointsRedeemed).toBe(200);
    expect(q.discountAmount).toBe(20_000);
  });
  it("above maxPct → caps to floor(cap × pointsPerCurrency) points and cap discount", () => {
    // pointsPerCurrency=0.01, invoice=10000, maxPct=50 → cap = 5000 → cap points = 50
    const q = quoteRedemption({
      requestedPoints: 400,
      balance: 500,
      program: defaultProgram,
      invoiceTotal: 10_000,
    });
    expect(q.ok).toBe(true);
    expect(q.pointsRedeemed).toBe(50);
    expect(q.discountAmount).toBe(5000);
  });
  it("pointsPerCurrency=0 (misconfigured) → reject", () => {
    const q = quoteRedemption({
      requestedPoints: 200,
      balance: 500,
      program: { ...defaultProgram, pointsPerCurrency: 0 },
      invoiceTotal: 100_000,
    });
    expect(q.ok).toBe(false);
    expect(q.reason).toMatch(/invalid/);
  });
});

describe("computeLoyaltyDiscount", () => {
  it("inverts pointsPerCurrency — 100 pts at 0.01 → ₹10000", () => {
    expect(
      computeLoyaltyDiscount(100, { pointsPerCurrency: 0.01 }),
    ).toBe(10_000);
  });
  it("returns 0 for 0 points", () => {
    expect(
      computeLoyaltyDiscount(0, { pointsPerCurrency: 0.01 }),
    ).toBe(0);
  });
  it("returns 0 for misconfigured rate (0)", () => {
    expect(
      computeLoyaltyDiscount(100, { pointsPerCurrency: 0 }),
    ).toBe(0);
  });
  it("2dp rounding for fractional results", () => {
    // 100 / 3 = 33.333... → 33.33
    expect(
      computeLoyaltyDiscount(100, { pointsPerCurrency: 3 }),
    ).toBe(33.33);
  });
});

describe("sumRedeemedPoints", () => {
  it("filters by entryType='Redeemed' + salesInvoiceId", () => {
    const entries: LoyaltyEntryLike[] = [
      { entryType: "Earned", points: 500, salesInvoiceId: "si-1" },
      { entryType: "Redeemed", points: 100, salesInvoiceId: "si-1" },
      { entryType: "Redeemed", points: 50, salesInvoiceId: "si-2" },
      { entryType: "Redeemed", points: 25, salesInvoiceId: "si-1" },
    ];
    expect(sumRedeemedPoints(entries, "si-1")).toBe(125);
    expect(sumRedeemedPoints(entries, "si-2")).toBe(50);
    expect(sumRedeemedPoints(entries, "si-3")).toBe(0);
  });
  it("empty → 0", () => {
    expect(sumRedeemedPoints([], "si-x")).toBe(0);
  });
});

describe("computePointsEarned", () => {
  it("floors to integer", () => {
    // pointsPerCurrency=0.01, baseAmount=1234 → 12.34 → 12
    expect(computePointsEarned(1234, defaultProgram)).toBe(12);
  });
  it("0 base → 0", () => {
    expect(computePointsEarned(0, defaultProgram)).toBe(0);
  });
  it("0 rate → 0", () => {
    expect(computePointsEarned(1000, { ...defaultProgram, pointsPerCurrency: 0 })).toBe(0);
  });
});
