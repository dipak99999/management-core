import { describe, expect, it } from "vitest";
import {
  advanceRecurringDate,
  isScheduleExhausted,
  previewUpcomingRuns,
} from "./recurring";

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("advanceRecurringDate", () => {
  it("Daily × 1 → +1 day", () => {
    expect(advanceRecurringDate(utc("2026-03-15"), "Daily", 1).toISOString()).toBe(
      "2026-03-16T00:00:00.000Z",
    );
  });

  it("Weekly × 2 → +14 days", () => {
    expect(advanceRecurringDate(utc("2026-03-15"), "Weekly", 2).toISOString()).toBe(
      "2026-03-29T00:00:00.000Z",
    );
  });

  it("Monthly × 1 → +1 month, preserves day-of-month", () => {
    expect(advanceRecurringDate(utc("2026-01-15"), "Monthly", 1).toISOString()).toBe(
      "2026-02-15T00:00:00.000Z",
    );
  });

  it("Monthly × 3 → same as Quarterly × 1", () => {
    const a = advanceRecurringDate(utc("2026-01-15"), "Monthly", 3);
    const b = advanceRecurringDate(utc("2026-01-15"), "Quarterly", 1);
    expect(a.toISOString()).toBe(b.toISOString());
  });

  it("Yearly × 1 → +1 year", () => {
    expect(advanceRecurringDate(utc("2026-03-15"), "Yearly", 1).toISOString()).toBe(
      "2027-03-15T00:00:00.000Z",
    );
  });

  it("snaps to UTC midnight (day-of-month drift wouldn't happen on 09:00 templates)", () => {
    const with_time = new Date("2026-03-15T09:30:00.000Z");
    const out = advanceRecurringDate(with_time, "Monthly", 1);
    expect(out.toISOString()).toBe("2026-04-15T00:00:00.000Z");
  });

  it("Feb 29 (leap) → advancing 1 year lands on Feb 28 or Mar 1 depending on JS Date semantics", () => {
    // JS Date rolls Feb 29 → Mar 1 when incrementing year across a
    // non-leap boundary. Test locks that behaviour so future refactors
    // don't silently change it.
    const out = advanceRecurringDate(utc("2024-02-29"), "Yearly", 1);
    // 2025 is not a leap year; Feb 29 becomes Mar 1.
    expect(out.toISOString()).toBe("2025-03-01T00:00:00.000Z");
  });

  it("floors intervalCount to at least 1 (schema allows 0/negative in principle)", () => {
    expect(advanceRecurringDate(utc("2026-01-15"), "Monthly", 0).toISOString()).toBe(
      "2026-02-15T00:00:00.000Z",
    );
  });
});

describe("previewUpcomingRuns", () => {
  it("returns exactly N dates when no endDate constrains it", () => {
    const runs = previewUpcomingRuns({
      frequency: "Monthly",
      intervalCount: 1,
      nextRunDate: utc("2026-01-15"),
      count: 3,
    });
    expect(runs).toHaveLength(3);
    expect(runs.map((r) => r.toISOString())).toEqual([
      "2026-01-15T00:00:00.000Z",
      "2026-02-15T00:00:00.000Z",
      "2026-03-15T00:00:00.000Z",
    ]);
  });

  it("stops early when endDate falls between two runs", () => {
    const runs = previewUpcomingRuns({
      frequency: "Monthly",
      intervalCount: 1,
      nextRunDate: utc("2026-01-15"),
      endDate: utc("2026-02-20"),
      count: 6,
    });
    // Jan 15 + Feb 15 fit before endDate; Mar 15 is past → stops.
    expect(runs.map((r) => r.toISOString())).toEqual([
      "2026-01-15T00:00:00.000Z",
      "2026-02-15T00:00:00.000Z",
    ]);
  });

  it("returns empty when nextRunDate is already past endDate", () => {
    expect(
      previewUpcomingRuns({
        frequency: "Monthly",
        intervalCount: 1,
        nextRunDate: utc("2026-04-01"),
        endDate: utc("2026-03-15"),
        count: 3,
      }),
    ).toEqual([]);
  });

  it("count=1 returns just the upcoming date (for compact list-view display)", () => {
    const runs = previewUpcomingRuns({
      frequency: "Quarterly",
      intervalCount: 1,
      nextRunDate: utc("2026-04-01"),
      count: 1,
    });
    expect(runs).toHaveLength(1);
    expect(runs[0].toISOString()).toBe("2026-04-01T00:00:00.000Z");
  });
});

describe("isScheduleExhausted", () => {
  it("false when no endDate", () => {
    expect(isScheduleExhausted(utc("2030-01-01"), null)).toBe(false);
    expect(isScheduleExhausted(utc("2030-01-01"), undefined)).toBe(false);
  });

  it("false when nextRun is before endDate", () => {
    expect(isScheduleExhausted(utc("2026-01-15"), utc("2026-06-30"))).toBe(false);
  });

  it("false when nextRun equals endDate (endDate is inclusive)", () => {
    expect(isScheduleExhausted(utc("2026-06-30"), utc("2026-06-30"))).toBe(false);
  });

  it("true when nextRun is past endDate", () => {
    expect(isScheduleExhausted(utc("2026-07-01"), utc("2026-06-30"))).toBe(true);
  });
});
