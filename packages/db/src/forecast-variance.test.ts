import { describe, expect, it } from "vitest";
import { firstNegativeBucket, forecastCashPosition } from "./cash-forecast";
import { computeVariance, summarizeByRootType } from "./budget-variance";

describe("forecastCashPosition", () => {
  const asOf = new Date("2026-03-01T00:00:00Z");

  it("returns bucketCount = horizon / bucketSize", () => {
    const r = forecastCashPosition({
      openingBalance: 100000,
      asOfDate: asOf,
      horizonDays: 30,
      granularity: "daily",
      receipts: [],
      payments: [],
    });
    expect(r).toHaveLength(30);
    expect(r[0].label).toMatch(/^2026-03-\d\d$/);
  });

  it("daily granularity: receipts on a specific day land in that day's bucket only", () => {
    const r = forecastCashPosition({
      openingBalance: 0,
      asOfDate: asOf,
      horizonDays: 5,
      granularity: "daily",
      receipts: [
        {
          dueDate: new Date("2026-03-03T10:00:00Z"),
          amount: 1000,
          sourceDoc: "SI-1",
          sourceKind: "SalesInvoice",
        },
      ],
      payments: [],
    });
    // Day 0 = 2026-03-01, day 2 = 2026-03-03.
    expect(r[0].inflow).toBe(0);
    expect(r[2].inflow).toBe(1000);
    expect(r[4].inflow).toBe(0);
  });

  it("weekly granularity aggregates 7-day windows", () => {
    const r = forecastCashPosition({
      openingBalance: 5000,
      asOfDate: asOf,
      horizonDays: 21,
      granularity: "weekly",
      receipts: [
        { dueDate: new Date("2026-03-03T10:00:00Z"), amount: 1000, sourceDoc: "SI-1", sourceKind: "SalesInvoice" },
        { dueDate: new Date("2026-03-06T10:00:00Z"), amount: 500, sourceDoc: "SI-2", sourceKind: "SalesInvoice" },
      ],
      payments: [
        { dueDate: new Date("2026-03-15T10:00:00Z"), amount: 2000, sourceDoc: "PI-1", sourceKind: "PurchaseInvoice" },
      ],
    });
    expect(r).toHaveLength(3);
    // From 2026-03-01: week 0 = 03-01..03-07, week 1 = 03-08..03-14,
    // week 2 = 03-15..03-21. Payment on 03-15 falls in week 2.
    expect(r[0].inflow).toBe(1500);
    expect(r[1].outflow).toBe(0);
    expect(r[2].outflow).toBe(2000);
    expect(r[0].runningBalance).toBe(6500);
    expect(r[1].runningBalance).toBe(6500);
    expect(r[2].runningBalance).toBe(4500);
  });

  it("firstNegativeBucket finds the day cash runs out", () => {
    const buckets = forecastCashPosition({
      openingBalance: 1000,
      asOfDate: asOf,
      horizonDays: 5,
      granularity: "daily",
      receipts: [],
      payments: [
        { dueDate: new Date("2026-03-02T10:00:00Z"), amount: 500, sourceDoc: "PI-1", sourceKind: "PurchaseInvoice" },
        { dueDate: new Date("2026-03-03T10:00:00Z"), amount: 700, sourceDoc: "PI-2", sourceKind: "PurchaseInvoice" },
      ],
    });
    // Day 0: 1000, day 1: 500, day 2: -200 (negative here).
    expect(firstNegativeBucket(buckets)).toBe(2);
  });

  it("firstNegativeBucket returns -1 if never goes negative", () => {
    const buckets = forecastCashPosition({
      openingBalance: 5000,
      asOfDate: asOf,
      horizonDays: 3,
      granularity: "daily",
      receipts: [],
      payments: [],
    });
    expect(firstNegativeBucket(buckets)).toBe(-1);
  });
});

describe("computeVariance", () => {
  it("Expense under budget → OnTrack", () => {
    const v = computeVariance({
      accountId: "a",
      accountName: "Marketing",
      rootType: "Expense",
      budgetAmount: 10000,
      actualAmount: 5000,
      costCenterId: null,
      costCenterName: null,
    });
    expect(v.utilization).toBe(50);
    expect(v.status).toBe("OnTrack");
    expect(v.variancePct).toBe(-50);
  });

  it("Warning band 80-100%", () => {
    const v = computeVariance({
      accountId: "a",
      accountName: "Marketing",
      rootType: "Expense",
      budgetAmount: 10000,
      actualAmount: 8500,
      costCenterId: null,
      costCenterName: null,
    });
    expect(v.status).toBe("Warning");
  });

  it("Over 100% → Over", () => {
    const v = computeVariance({
      accountId: "a",
      accountName: "Marketing",
      rootType: "Expense",
      budgetAmount: 10000,
      actualAmount: 12500,
      costCenterId: null,
      costCenterName: null,
    });
    expect(v.status).toBe("Over");
    expect(v.variancePct).toBe(25);
  });

  it("zero budget with actual → infinite variance (capped 999)", () => {
    const v = computeVariance({
      accountId: "a",
      accountName: "Unexpected",
      rootType: "Expense",
      budgetAmount: 0,
      actualAmount: 1000,
      costCenterId: null,
      costCenterName: null,
    });
    expect(v.variancePct).toBe(999);
  });

  it("zero budget + zero actual → no variance shown", () => {
    const v = computeVariance({
      accountId: "a",
      accountName: "Idle",
      rootType: "Expense",
      budgetAmount: 0,
      actualAmount: 0,
      costCenterId: null,
      costCenterName: null,
    });
    expect(v.variancePct).toBe(0);
    expect(v.status).toBe("OnTrack");
  });
});

describe("summarizeByRootType", () => {
  it("aggregates rows into per-rootType totals in canonical order", () => {
    const totals = summarizeByRootType([
      computeVariance({
        accountId: "a", accountName: "A", rootType: "Expense",
        budgetAmount: 1000, actualAmount: 800, costCenterId: null, costCenterName: null,
      }),
      computeVariance({
        accountId: "b", accountName: "B", rootType: "Expense",
        budgetAmount: 500, actualAmount: 600, costCenterId: null, costCenterName: null,
      }),
      computeVariance({
        accountId: "c", accountName: "C", rootType: "Income",
        budgetAmount: 10000, actualAmount: 8000, costCenterId: null, costCenterName: null,
      }),
    ]);
    expect(totals.map((t) => t.rootType)).toEqual(["Income", "Expense"]);
    expect(totals[1].totalBudget).toBe(1500);
    expect(totals[1].totalActual).toBe(1400);
    expect(totals[1].rowCount).toBe(2);
    // (1400 - 1500) / 1500 * 100 = -6.66
    expect(totals[1].variancePct).toBeCloseTo(-6.666, 2);
  });
});
