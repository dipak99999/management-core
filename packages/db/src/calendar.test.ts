import { describe, expect, it } from "vitest";
import {
  bucketEventsByDay,
  buildMonthGrid,
  shiftMonth,
  toIso,
} from "./calendar";

describe("buildMonthGrid", () => {
  it("returns exactly 42 cells (6 rows × 7 cols) for any month", () => {
    // Every month has enough padding to fit into 6 weeks.
    expect(buildMonthGrid(2026, 0)).toHaveLength(42); // Jan 2026
    expect(buildMonthGrid(2026, 1)).toHaveLength(42); // Feb 2026 (28-day)
    expect(buildMonthGrid(2024, 1)).toHaveLength(42); // Feb 2024 (29-day leap)
  });

  it("marks in-month days correctly (April 2026 = 30 days)", () => {
    const grid = buildMonthGrid(2026, 3); // April 2026
    const inMonth = grid.filter((c) => c.inMonth);
    expect(inMonth).toHaveLength(30);
    expect(inMonth[0].iso).toBe("2026-04-01");
    expect(inMonth[29].iso).toBe("2026-04-30");
  });

  it("pads with previous-month days when the 1st is not on the week start (sunday-start)", () => {
    // April 1 2026 is a Wednesday. Sunday-start → 3 days of March padding.
    const grid = buildMonthGrid(2026, 3, "sunday");
    expect(grid.slice(0, 3).every((c) => !c.inMonth)).toBe(true);
    expect(grid[0].iso).toBe("2026-03-29"); // Sun
    expect(grid[3].iso).toBe("2026-04-01"); // Wed
  });

  it("shifts padding for monday-start (Wed → 2 days of Mon-Tue padding)", () => {
    // April 1 2026 is Wed. Monday-start → padding from Mon Mar 30, Tue Mar 31.
    const grid = buildMonthGrid(2026, 3, "monday");
    expect(grid[0].iso).toBe("2026-03-30");
    expect(grid[1].iso).toBe("2026-03-31");
    expect(grid[2].iso).toBe("2026-04-01");
  });

  it("marks today = true for exactly one cell when today is in the month", () => {
    const today = new Date("2026-04-15T12:00:00.000Z");
    const grid = buildMonthGrid(2026, 3, "sunday", today);
    const todays = grid.filter((c) => c.isToday);
    expect(todays).toHaveLength(1);
    expect(todays[0].iso).toBe("2026-04-15");
  });

  it("no cell is marked today when today falls outside the padded grid range", () => {
    const today = new Date("2027-01-01T12:00:00.000Z");
    const grid = buildMonthGrid(2026, 3, "sunday", today);
    expect(grid.every((c) => !c.isToday)).toBe(true);
  });
});

describe("shiftMonth", () => {
  it("advances by 1 month within the year", () => {
    expect(shiftMonth(2026, 3, 1)).toEqual({ year: 2026, monthIndex: 4 });
  });

  it("wraps forward across December", () => {
    expect(shiftMonth(2026, 11, 1)).toEqual({ year: 2027, monthIndex: 0 });
  });

  it("wraps backward across January", () => {
    expect(shiftMonth(2026, 0, -1)).toEqual({ year: 2025, monthIndex: 11 });
  });

  it("handles multi-year jumps in either direction", () => {
    expect(shiftMonth(2026, 3, 24)).toEqual({ year: 2028, monthIndex: 3 });
    expect(shiftMonth(2026, 3, -25)).toEqual({ year: 2024, monthIndex: 2 });
  });
});

describe("bucketEventsByDay — point events", () => {
  it("puts a single-day event into exactly one bucket", () => {
    const rows = [{ id: "a", when: "2026-04-15T12:00:00.000Z" }];
    const buckets = bucketEventsByDay(rows, (r) => r.when);
    expect(buckets.get("2026-04-15")?.length).toBe(1);
    expect(buckets.get("2026-04-16")).toBeUndefined();
  });

  it("groups multiple events on the same day", () => {
    const rows = [
      { id: "a", when: "2026-04-15T09:00:00.000Z" },
      { id: "b", when: "2026-04-15T17:00:00.000Z" },
    ];
    const buckets = bucketEventsByDay(rows, (r) => r.when);
    expect(buckets.get("2026-04-15")?.length).toBe(2);
  });

  it("skips rows with a null date rather than throwing", () => {
    const rows = [
      { id: "a", when: null },
      { id: "b", when: "2026-04-15T12:00:00.000Z" },
    ];
    const buckets = bucketEventsByDay(rows, (r) => r.when);
    expect(buckets.size).toBe(1);
    expect(buckets.get("2026-04-15")?.length).toBe(1);
  });

  it("skips rows with malformed date strings rather than crashing", () => {
    const rows = [
      { id: "a", when: "not-a-date" },
      { id: "b", when: "2026-04-15T12:00:00.000Z" },
    ];
    const buckets = bucketEventsByDay(rows, (r) => r.when);
    expect(buckets.size).toBe(1);
  });
});

describe("bucketEventsByDay — range events (leave/task/order date-range)", () => {
  it("expands a Mon-Wed range across three days", () => {
    const rows = [
      {
        id: "leave",
        from: "2026-04-13T00:00:00.000Z", // Mon
        to: "2026-04-15T00:00:00.000Z",   // Wed
      },
    ];
    const buckets = bucketEventsByDay(
      rows,
      (r) => r.from,
      (r) => r.to,
    );
    expect(buckets.get("2026-04-13")?.length).toBe(1);
    expect(buckets.get("2026-04-14")?.length).toBe(1);
    expect(buckets.get("2026-04-15")?.length).toBe(1);
    expect(buckets.get("2026-04-16")).toBeUndefined();
  });

  it("handles inverted ranges (end < start) by swapping — no data loss", () => {
    // If someone types 15 → 13 by mistake, we still show the event rather
    // than silently dropping it.
    const rows = [
      {
        id: "backwards",
        from: "2026-04-15T00:00:00.000Z",
        to: "2026-04-13T00:00:00.000Z",
      },
    ];
    const buckets = bucketEventsByDay(
      rows,
      (r) => r.from,
      (r) => r.to,
    );
    expect(buckets.get("2026-04-13")?.length).toBe(1);
    expect(buckets.get("2026-04-15")?.length).toBe(1);
  });

  it("caps expansion at 366 days (guard against data-entry mistakes)", () => {
    // A "leave application" from 2020 to 2026 shouldn't render 2000+ chips.
    const rows = [
      {
        id: "runaway",
        from: "2020-01-01T00:00:00.000Z",
        to: "2026-12-31T00:00:00.000Z",
      },
    ];
    const buckets = bucketEventsByDay(
      rows,
      (r) => r.from,
      (r) => r.to,
    );
    expect(buckets.size).toBe(366);
  });
});

describe("toIso", () => {
  it("returns UTC YYYY-MM-DD regardless of local tz", () => {
    // Use a UTC midnight input so the result is unambiguous.
    expect(toIso(new Date("2026-04-15T00:00:00.000Z"))).toBe("2026-04-15");
  });

  it("zero-pads month + day", () => {
    expect(toIso(new Date("2026-01-05T12:00:00.000Z"))).toBe("2026-01-05");
  });
});
