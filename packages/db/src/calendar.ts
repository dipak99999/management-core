// Calendar view pure helpers — shared across every list page that gets a
// month-view toggle. Kept here so vitest can exercise the tricky date
// arithmetic (Sunday vs Monday start, DST, range events spanning weeks)
// without a live DB or a rendered React component.
//
// Used by apps/*/components/calendar.tsx. The visual grid + drag/drop is
// per-app; the date math is here.

// -----------------------------------------------------------------------
// Month grid — a 6-row × 7-column matrix of Date objects representing a
// full calendar month plus padding from adjacent months. Standard shape
// that matches how every calendar UI renders (Google/Apple/ERPNext all
// use it). 42 cells is always enough — a month spans at most 6 rows even
// when it starts late in a week.

export type WeekStart = "sunday" | "monday";

export interface MonthGridCell {
  date: Date;              // UTC midnight
  iso: string;             // "YYYY-MM-DD"
  inMonth: boolean;        // false → this cell is padding from prev/next month
  isToday: boolean;
}

/**
 * Build a 6×7 grid of days for a given (year, monthIndex). monthIndex is
 * 0-based to match JS Date (0 = January). Sunday-start by default; pass
 * `"monday"` to shift for European locales.
 */
export function buildMonthGrid(
  year: number,
  monthIndex: number,
  weekStart: WeekStart = "sunday",
  today: Date = new Date(),
): MonthGridCell[] {
  const first = new Date(Date.UTC(year, monthIndex, 1));
  const dowFirst = first.getUTCDay(); // 0=Sun … 6=Sat
  // How many days from the previous month we need to backfill before day 1.
  const offset = weekStart === "sunday" ? dowFirst : (dowFirst + 6) % 7;
  const start = new Date(Date.UTC(year, monthIndex, 1 - offset));

  const todayIso = toIso(today);
  const cells: MonthGridCell[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getTime() + i * 24 * 60 * 60 * 1000);
    cells.push({
      date: d,
      iso: toIso(d),
      inMonth: d.getUTCMonth() === monthIndex,
      isToday: toIso(d) === todayIso,
    });
  }
  return cells;
}

/** ISO YYYY-MM-DD from a Date, UTC. */
export function toIso(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// -----------------------------------------------------------------------
// Event bucketing. For point-in-time events (a Sales Invoice's due date)
// each event appears on one day. For range events (a Leave Application
// from Mon → Fri) each event appears on EVERY day in the range so the
// bar/chip renders across the row.

export interface CalendarEvent<T> {
  row: T;
  from: Date;
  to: Date; // === from for point events
}

/**
 * Group events by ISO day, expanding ranges so a single event that spans
 * three days shows up in three buckets. Returns a Map for O(1) lookup
 * during render.
 *
 * `getFrom` / `getTo` let callers adapt to their data — pass the same
 * function twice for point events, or two different accessors for ranges.
 */
export function bucketEventsByDay<T>(
  rows: T[],
  getFrom: (row: T) => Date | string | null | undefined,
  getTo: (row: T) => Date | string | null | undefined = getFrom,
): Map<string, CalendarEvent<T>[]> {
  const buckets = new Map<string, CalendarEvent<T>[]>();
  for (const row of rows) {
    const rawFrom = getFrom(row);
    if (!rawFrom) continue;
    const from = asDate(rawFrom);
    const rawTo = getTo(row) ?? rawFrom;
    const to = asDate(rawTo);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) continue;
    // Iterate every UTC day in [from, to]. Guard against inverted ranges
    // by swapping — the calendar shouldn't disappear the event just
    // because the operator entered end < start.
    const [lo, hi] = from <= to ? [from, to] : [to, from];
    // Snap to UTC midnight for stable iteration.
    let cursor = new Date(
      Date.UTC(lo.getUTCFullYear(), lo.getUTCMonth(), lo.getUTCDate()),
    );
    const stop = new Date(
      Date.UTC(hi.getUTCFullYear(), hi.getUTCMonth(), hi.getUTCDate()),
    );
    // Safety cap — a leave app of 5 years shouldn't hang the UI. 366 days
    // covers a normal calendar view, and returning early is preferable to
    // rendering 1800 chips for a data-entry mistake.
    let guard = 0;
    while (cursor <= stop && guard < 366) {
      const iso = toIso(cursor);
      const existing = buckets.get(iso) ?? [];
      existing.push({ row, from, to });
      buckets.set(iso, existing);
      cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
      guard++;
    }
  }
  return buckets;
}

function asDate(v: Date | string): Date {
  return typeof v === "string" ? new Date(v) : v;
}

// -----------------------------------------------------------------------
// Navigation helpers — pure, so the tests can pin behaviour without
// mocking `new Date()`.

/**
 * Shift a (year, monthIndex) by ±n months. Wraps year on Jan/Dec cross.
 */
export function shiftMonth(
  year: number,
  monthIndex: number,
  delta: number,
): { year: number; monthIndex: number } {
  const total = year * 12 + monthIndex + delta;
  const newYear = Math.floor(total / 12);
  const newMonth = total - newYear * 12;
  return { year: newYear, monthIndex: newMonth };
}
