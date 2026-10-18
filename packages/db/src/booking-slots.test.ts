import { describe, expect, it } from "vitest";
import { generateSlots, isSlotAvailable, localWallClockToUtc, tzOffsetMinutes } from "./booking-slots";

// All tests use Asia/Kolkata (UTC+5:30, no DST) to keep expectations
// stable across systems. One test exercises America/New_York for DST.

const mtype = (durationMinutes = 30, bufferMinutes = 0, minNoticeMinutes = 0, maxAdvanceDays = 30) => ({
  durationMinutes,
  bufferMinutes,
  minNoticeMinutes,
  maxAdvanceDays,
});

describe("tzOffsetMinutes", () => {
  it("returns +330 for Asia/Kolkata (no DST)", () => {
    expect(tzOffsetMinutes("Asia/Kolkata", new Date("2026-06-15T00:00:00Z"))).toBe(330);
  });

  it("returns 0 for UTC", () => {
    expect(tzOffsetMinutes("UTC", new Date("2026-06-15T00:00:00Z"))).toBe(0);
  });

  it("handles America/New_York DST switch", () => {
    // Mid-summer EDT = UTC-4
    expect(tzOffsetMinutes("America/New_York", new Date("2026-07-15T12:00:00Z"))).toBe(-240);
    // Mid-winter EST = UTC-5
    expect(tzOffsetMinutes("America/New_York", new Date("2026-01-15T12:00:00Z"))).toBe(-300);
  });
});

describe("localWallClockToUtc", () => {
  it("converts 2026-06-15 09:00 IST → 03:30 UTC", () => {
    const d = localWallClockToUtc(2026, 6, 15, 9 * 60, "Asia/Kolkata");
    expect(d.toISOString()).toBe("2026-06-15T03:30:00.000Z");
  });

  it("converts 2026-06-15 12:00 UTC → 12:00 UTC (identity)", () => {
    const d = localWallClockToUtc(2026, 6, 15, 12 * 60, "UTC");
    expect(d.toISOString()).toBe("2026-06-15T12:00:00.000Z");
  });
});

describe("generateSlots", () => {
  const tz = "Asia/Kolkata";
  const now = new Date("2026-06-15T00:00:00Z"); // Monday 05:30 IST
  const rangeStart = new Date("2026-06-15T00:00:00Z");
  const rangeEnd = new Date("2026-06-16T00:00:00Z"); // Just Monday IST

  it("generates back-to-back slots inside one window", () => {
    // Monday (dow=1 in IST) 09:00–11:00 IST → four 30-min slots.
    const windows = [{ dayOfWeek: 1, startMinute: 9 * 60, endMinute: 11 * 60, timezone: tz }];
    const slots = generateSlots(mtype(30), windows, [], now, rangeStart, rangeEnd);
    expect(slots.map((s) => s.startsAt.toISOString())).toEqual([
      "2026-06-15T03:30:00.000Z",
      "2026-06-15T04:00:00.000Z",
      "2026-06-15T04:30:00.000Z",
      "2026-06-15T05:00:00.000Z",
    ]);
  });

  it("excludes slot overlapping an existing booking", () => {
    const windows = [{ dayOfWeek: 1, startMinute: 9 * 60, endMinute: 11 * 60, timezone: tz }];
    // Book 09:30–10:00 IST = 04:00–04:30 UTC → knock out that slot.
    const bookings = [
      { startsAt: new Date("2026-06-15T04:00:00Z"), endsAt: new Date("2026-06-15T04:30:00Z") },
    ];
    const slots = generateSlots(mtype(30), windows, bookings, now, rangeStart, rangeEnd);
    expect(slots.map((s) => s.startsAt.toISOString())).toEqual([
      "2026-06-15T03:30:00.000Z",
      "2026-06-15T04:30:00.000Z",
      "2026-06-15T05:00:00.000Z",
    ]);
  });

  it("applies buffer around bookings", () => {
    const windows = [{ dayOfWeek: 1, startMinute: 9 * 60, endMinute: 11 * 60, timezone: tz }];
    // Same booking but with 15-min buffer → both 09:30 and 10:00 slots knocked out.
    const bookings = [
      { startsAt: new Date("2026-06-15T04:00:00Z"), endsAt: new Date("2026-06-15T04:30:00Z") },
    ];
    const slots = generateSlots(mtype(30, 15), windows, bookings, now, rangeStart, rangeEnd);
    // Buffer makes the booking effectively 03:45–04:45 → 03:30-04:00 slot ends at 04:00 which
    // is NOT > 03:45 start of buffered booking... wait, 04:00 > 03:45 so it IS a conflict.
    // 03:30 slot (ends 04:00) conflicts (endsAt 04:00 > buffered start 03:45). So knocked.
    // 04:00 slot conflicts. 04:30 slot (starts 04:30) < buffered end 04:45 → conflicts.
    // 05:00 slot survives.
    expect(slots.map((s) => s.startsAt.toISOString())).toEqual(["2026-06-15T05:00:00.000Z"]);
  });

  it("respects minNoticeMinutes (rejects too-soon slots)", () => {
    // Now = 03:00 UTC, minNotice = 90 min → earliest = 04:30 UTC.
    const nowLate = new Date("2026-06-15T03:00:00Z");
    const windows = [{ dayOfWeek: 1, startMinute: 9 * 60, endMinute: 11 * 60, timezone: tz }];
    const slots = generateSlots(mtype(30, 0, 90), windows, [], nowLate, rangeStart, rangeEnd);
    expect(slots[0].startsAt.toISOString()).toBe("2026-06-15T04:30:00.000Z");
  });

  it("respects maxAdvanceDays (rejects too-far slots)", () => {
    // maxAdvance = 0 → nothing more than 0 days out is allowed.
    const windows = [{ dayOfWeek: 1, startMinute: 9 * 60, endMinute: 11 * 60, timezone: tz }];
    const slots = generateSlots(mtype(30, 0, 0, 0), windows, [], now, rangeStart, rangeEnd);
    expect(slots).toEqual([]);
  });

  it("skips windows whose dayOfWeek doesn't match the day being enumerated", () => {
    // Only a Sunday (dow=0) window in a Monday-only range.
    const windows = [{ dayOfWeek: 0, startMinute: 9 * 60, endMinute: 11 * 60, timezone: tz }];
    const slots = generateSlots(mtype(30), windows, [], now, rangeStart, rangeEnd);
    expect(slots).toEqual([]);
  });
});

describe("isSlotAvailable", () => {
  const tz = "Asia/Kolkata";
  const now = new Date("2026-06-15T00:00:00Z");
  const windows = [{ dayOfWeek: 1, startMinute: 9 * 60, endMinute: 11 * 60, timezone: tz }];

  it("returns true for an exact matching slot start", () => {
    const ok = isSlotAvailable(mtype(30), windows, [], now, new Date("2026-06-15T03:30:00Z"));
    expect(ok).toBe(true);
  });

  it("returns false for a slot start that doesn't align to duration boundary", () => {
    const ok = isSlotAvailable(mtype(30), windows, [], now, new Date("2026-06-15T03:45:00Z"));
    expect(ok).toBe(false);
  });

  it("returns false when the slot conflicts with a booking", () => {
    const bookings = [
      { startsAt: new Date("2026-06-15T03:30:00Z"), endsAt: new Date("2026-06-15T04:00:00Z") },
    ];
    const ok = isSlotAvailable(mtype(30), windows, bookings, now, new Date("2026-06-15T03:30:00Z"));
    expect(ok).toBe(false);
  });
});
