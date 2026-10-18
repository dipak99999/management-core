import { describe, expect, it } from "vitest";
import { computeDeferredSchedule } from "./deferred-revenue";

const jan1 = new Date(Date.UTC(2026, 0, 1));

describe("computeDeferredSchedule", () => {
  it("months=0 → empty", () => {
    expect(computeDeferredSchedule(1200, 0, jan1)).toEqual([]);
  });
  it("negative months → empty", () => {
    expect(computeDeferredSchedule(1200, -3, jan1)).toEqual([]);
  });
  it("totalAmount ≤ 0 → empty", () => {
    expect(computeDeferredSchedule(0, 12, jan1)).toEqual([]);
    expect(computeDeferredSchedule(-100, 12, jan1)).toEqual([]);
  });

  it("12 months × ₹1200 → 12 installments of ₹100", () => {
    const rows = computeDeferredSchedule(1200, 12, jan1);
    expect(rows).toHaveLength(12);
    expect(rows.every((r) => r.amount === 100)).toBe(true);
    expect(rows[0]?.dueDate.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(rows[11]?.dueDate.toISOString()).toBe("2026-12-01T00:00:00.000Z");
  });

  it("installmentNo is 1-based sequential", () => {
    const rows = computeDeferredSchedule(1200, 12, jan1);
    expect(rows.map((r) => r.installmentNo)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
  });

  it("sum invariant — last row absorbs rounding remainder", () => {
    // 100 / 3 = 33.33... → 33.33 × 2 + 33.34 = 100.00 exactly
    const rows = computeDeferredSchedule(100, 3, jan1);
    expect(rows[0]?.amount).toBe(33.33);
    expect(rows[1]?.amount).toBe(33.33);
    expect(rows[2]?.amount).toBe(33.34);
    const sum = rows.reduce((s, r) => s + r.amount, 0);
    expect(Math.round(sum * 100) / 100).toBe(100);
  });

  it("sum invariant for pathological 7 months × ₹1000", () => {
    const rows = computeDeferredSchedule(1000, 7, jan1);
    const sum = rows.reduce((s, r) => s + r.amount, 0);
    expect(Math.round(sum * 100) / 100).toBe(1000);
  });

  it("month rollover from Jan → Dec", () => {
    const rows = computeDeferredSchedule(2400, 24, jan1);
    expect(rows).toHaveLength(24);
    // Row 13 = 12 months after Jan 2026 → Jan 2027
    expect(rows[12]?.dueDate.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("start date preserved on day-of-month for stable months", () => {
    const feb15 = new Date(Date.UTC(2026, 1, 15));
    const rows = computeDeferredSchedule(600, 6, feb15);
    expect(rows[0]?.dueDate.toISOString()).toBe("2026-02-15T00:00:00.000Z");
    expect(rows[5]?.dueDate.toISOString()).toBe("2026-07-15T00:00:00.000Z");
  });

  it("month-end edge (start Jan 31 → Feb has no 31st, JS rolls forward)", () => {
    const jan31 = new Date(Date.UTC(2026, 0, 31));
    const rows = computeDeferredSchedule(600, 3, jan31);
    // Row 2 = Feb 31 → rolls to Mar 3rd (2026-02-31 + 0d = 2026-03-03)
    expect(rows[1]?.dueDate.toISOString()).toBe("2026-03-03T00:00:00.000Z");
  });

  it("months=1 → single installment for full amount", () => {
    const rows = computeDeferredSchedule(1000, 1, jan1);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.amount).toBe(1000);
  });
});
