// Meeting Scheduler — pure slot generation.
//
// Given:
//   * meeting type: durationMinutes, bufferMinutes, minNoticeMinutes,
//     maxAdvanceDays
//   * availability windows: weekly recurring (dayOfWeek, startMinute,
//     endMinute, timezone)
//   * existing bookings (UTC intervals) to exclude
//   * `now` — current instant (UTC)
//   * date range [rangeStart, rangeEnd] to enumerate (inclusive of both)
//
// We enumerate each day in the range, and for each AvailabilityWindow
// whose dayOfWeek matches, compute the window's UTC boundary from
// (date + startMinute) in the window's timezone. Then slot the window
// at `durationMinutes` steps, dropping any slot that:
//   * starts before `now + minNoticeMinutes`
//   * starts after `now + maxAdvanceDays * 24h`
//   * overlaps a booking (booking window is expanded by bufferMinutes
//     on each side)
//   * ends after the window end
//
// Kept dependency-free — timezones are handled with a small helper
// that computes the offset for a given (year, month, day, tz) via
// Intl.DateTimeFormat.formatToParts (works on Node 20+).

export interface AvailabilityWindowInput {
  dayOfWeek: number; // 0..6, 0 = Sunday
  startMinute: number;
  endMinute: number;
  timezone: string;
}

export interface BookingInput {
  startsAt: Date;
  endsAt: Date;
}

export interface MeetingTypeConfig {
  durationMinutes: number;
  bufferMinutes: number;
  minNoticeMinutes: number;
  maxAdvanceDays: number;
}

export interface Slot {
  startsAt: Date;
  endsAt: Date;
}

// Compute the timezone offset (in minutes east of UTC) for a wall-clock
// instant in `tz`. Positive for tz east of UTC (Asia/Kolkata → +330).
export function tzOffsetMinutes(tz: string, wallClockUtc: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = dtf.formatToParts(wallClockUtc);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const y = get("year");
  const mo = get("month");
  const d = get("day");
  let h = get("hour");
  const mi = get("minute");
  const s = get("second");
  if (h === 24) h = 0; // Intl quirk on some runtimes
  const asIfUtc = Date.UTC(y, mo - 1, d, h, mi, s);
  return Math.round((asIfUtc - wallClockUtc.getTime()) / 60000);
}

// Turn (year, month, day, minuteOfDay, timezone) into a UTC Date.
// Iterates twice to handle DST-day cases where the offset at the
// wall-clock instant differs from the offset at the initial guess.
export function localWallClockToUtc(
  year: number,
  month: number, // 1..12
  day: number,
  minuteOfDay: number,
  tz: string,
): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, Math.floor(minuteOfDay / 60), minuteOfDay % 60));
  const offset1 = tzOffsetMinutes(tz, guess);
  const adjusted = new Date(guess.getTime() - offset1 * 60000);
  const offset2 = tzOffsetMinutes(tz, adjusted);
  if (offset2 === offset1) return adjusted;
  return new Date(guess.getTime() - offset2 * 60000);
}

// Return the day-of-week (0..6, Sunday-first) that `dateUtc` falls on
// in `tz`.
function dayOfWeekInTz(dateUtc: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
  });
  const wd = dtf.format(dateUtc);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd);
}

// Iterate calendar days from rangeStart to rangeEnd inclusive, yielding
// {year, month, day} in the given timezone.
function* eachDayInTz(rangeStart: Date, rangeEnd: Date, tz: string): Generator<{ year: number; month: number; day: number }> {
  const dtf = new Intl.DateTimeFormat("en-CA", { // en-CA gives YYYY-MM-DD
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const seen = new Set<string>();
  const oneHour = 60 * 60 * 1000;
  for (let t = rangeStart.getTime(); t <= rangeEnd.getTime() + oneHour; t += oneHour) {
    const s = dtf.format(new Date(t));
    if (seen.has(s)) continue;
    seen.add(s);
    const [y, m, d] = s.split("-").map(Number);
    yield { year: y, month: m, day: d };
  }
}

export function generateSlots(
  meetingType: MeetingTypeConfig,
  windows: AvailabilityWindowInput[],
  bookings: BookingInput[],
  now: Date,
  rangeStart: Date,
  rangeEnd: Date,
): Slot[] {
  if (meetingType.durationMinutes <= 0) return [];
  const earliest = new Date(now.getTime() + meetingType.minNoticeMinutes * 60000);
  const latest = new Date(now.getTime() + meetingType.maxAdvanceDays * 24 * 60 * 60000);
  const effectiveStart = rangeStart < earliest ? earliest : rangeStart;
  const effectiveEnd = rangeEnd < latest ? rangeEnd : latest;
  if (effectiveEnd < effectiveStart) return [];

  // Bookings expanded by buffer on each side, for overlap tests.
  const blockedIntervals = bookings.map((b) => ({
    startsAt: new Date(b.startsAt.getTime() - meetingType.bufferMinutes * 60000),
    endsAt: new Date(b.endsAt.getTime() + meetingType.bufferMinutes * 60000),
  }));

  const slots: Slot[] = [];
  const windowsByTz = new Map<string, AvailabilityWindowInput[]>();
  for (const w of windows) {
    const bucket = windowsByTz.get(w.timezone) ?? [];
    bucket.push(w);
    windowsByTz.set(w.timezone, bucket);
  }

  for (const [tz, tzWindows] of windowsByTz) {
    for (const day of eachDayInTz(effectiveStart, effectiveEnd, tz)) {
      // Find the day-of-week for the noon-in-tz instant of this day
      // (noon avoids DST edge cases at midnight).
      const noon = localWallClockToUtc(day.year, day.month, day.day, 12 * 60, tz);
      const dow = dayOfWeekInTz(noon, tz);
      const matches = tzWindows.filter((w) => w.dayOfWeek === dow);
      for (const w of matches) {
        const winStart = localWallClockToUtc(day.year, day.month, day.day, w.startMinute, tz);
        const winEnd = localWallClockToUtc(day.year, day.month, day.day, w.endMinute, tz);
        // Step through the window at durationMinutes intervals.
        for (
          let slotStart = winStart.getTime();
          slotStart + meetingType.durationMinutes * 60000 <= winEnd.getTime();
          slotStart += meetingType.durationMinutes * 60000
        ) {
          const startsAt = new Date(slotStart);
          const endsAt = new Date(slotStart + meetingType.durationMinutes * 60000);
          if (startsAt < effectiveStart || startsAt > effectiveEnd) continue;
          // Overlap check against blocked intervals.
          const conflict = blockedIntervals.some(
            (b) => startsAt < b.endsAt && endsAt > b.startsAt,
          );
          if (conflict) continue;
          slots.push({ startsAt, endsAt });
        }
      }
    }
  }
  // Sort + dedupe (multiple windows on the same day could produce duplicates
  // if configured with overlaps).
  slots.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const dedup: Slot[] = [];
  for (const s of slots) {
    const last = dedup[dedup.length - 1];
    if (!last || last.startsAt.getTime() !== s.startsAt.getTime()) dedup.push(s);
  }
  return dedup;
}

// Check whether a proposed booking [startsAt, startsAt+duration) is
// consistent with the same window/booking constraints. Used server-side
// on POST /book to reject a client whose slot list is stale.
export function isSlotAvailable(
  meetingType: MeetingTypeConfig,
  windows: AvailabilityWindowInput[],
  bookings: BookingInput[],
  now: Date,
  startsAt: Date,
): boolean {
  const endsAt = new Date(startsAt.getTime() + meetingType.durationMinutes * 60000);
  const slots = generateSlots(
    meetingType,
    windows,
    bookings,
    now,
    startsAt,
    endsAt,
  );
  return slots.some(
    (s) => s.startsAt.getTime() === startsAt.getTime() && s.endsAt.getTime() === endsAt.getTime(),
  );
}
