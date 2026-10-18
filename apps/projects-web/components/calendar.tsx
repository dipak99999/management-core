"use client";

// Lumaara CalendarView — a Zoho-inspired month grid used across every list
// page that has date-bearing rows. Same shape as our KanbanBoard:
// dependency-free, pure controlled component, the caller owns the rows.
//
// We only:
//   1. Render a 6×7 month grid via `buildMonthGrid` (from @lumaara/db).
//   2. Bucket rows into per-day chips via `bucketEventsByDay`.
//   3. Emit `onRowClick(row)` when a chip is clicked.
//
// The date arithmetic (padded months, range expansion, week-start,
// today-marker) lives in the pure helper package so it's tested without
// a browser.

import { ReactNode, useMemo, useState } from "react";
import {
  bucketEventsByDay,
  buildMonthGrid,
  shiftMonth,
  type WeekStart,
} from "@lumaara/db/calendar";

export interface CalendarViewProps<T> {
  rows: T[];
  /** Point events pass just this; range events also pass `getEnd`. */
  getStart: (row: T) => Date | string | null | undefined;
  getEnd?: (row: T) => Date | string | null | undefined;
  /** Stable key for React reconciliation. */
  rowKey: (row: T) => string;
  /** Compact chip label — kept to 1 line inside the day cell. */
  renderChip: (row: T) => ReactNode;
  /** Tailwind class for the chip background/accent, e.g. "bg-blue-500". */
  chipAccent?: (row: T) => string;
  onRowClick?: (row: T) => void;
  weekStart?: WeekStart;
  /** Empty-state message when the visible month has zero events. */
  emptyMessage?: string;
  /**
   * Initial month (default = current month). Kept as a prop so a caller
   * can deep-link to a specific month via query params later.
   */
  initialYear?: number;
  initialMonth?: number;
}

const DOW_SUNDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DOW_MONDAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Max chips visible per cell before we collapse to a "+N more" footer.
// Chosen so a 5-line cell fits on a normal laptop viewport (~110px cell
// height at default sizing).
const CHIPS_PER_CELL = 3;

export function CalendarView<T>({
  rows,
  getStart,
  getEnd,
  rowKey,
  renderChip,
  chipAccent,
  onRowClick,
  weekStart = "sunday",
  emptyMessage,
  initialYear,
  initialMonth,
}: CalendarViewProps<T>) {
  const now = new Date();
  const [year, setYear] = useState(initialYear ?? now.getUTCFullYear());
  const [monthIndex, setMonthIndex] = useState(
    initialMonth ?? now.getUTCMonth(),
  );

  const cells = useMemo(
    () => buildMonthGrid(year, monthIndex, weekStart),
    [year, monthIndex, weekStart],
  );
  const buckets = useMemo(
    () => bucketEventsByDay(rows, getStart, getEnd ?? getStart),
    [rows, getStart, getEnd],
  );
  const dowLabels = weekStart === "monday" ? DOW_MONDAY : DOW_SUNDAY;

  function shift(delta: number) {
    const { year: y, monthIndex: m } = shiftMonth(year, monthIndex, delta);
    setYear(y);
    setMonthIndex(m);
  }
  function jumpToToday() {
    setYear(now.getUTCFullYear());
    setMonthIndex(now.getUTCMonth());
  }

  // Count events in the visible in-month range so the empty state is
  // meaningful ("no leave applications this month" — not "ever").
  const inMonthEventCount = cells.reduce((s, c) => {
    if (!c.inMonth) return s;
    return s + (buckets.get(c.iso)?.length ?? 0);
  }, 0);
  const showEmpty = inMonthEventCount === 0 && emptyMessage;

  return (
    <div className="lumaara-calendar rounded-xl border border-ink-muted/10 bg-white">
      {/* Header — month title + prev/next/today */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-ink-muted/10">
        <div className="text-sm font-semibold text-ink">
          {MONTH_LABELS[monthIndex]} {year}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => shift(-1)}
            className="px-2 py-1 rounded hover:bg-brand-50 text-ink-muted hover:text-ink text-xs"
            aria-label="Previous month"
          >
            ←
          </button>
          <button
            onClick={jumpToToday}
            className="px-2 py-1 rounded hover:bg-brand-50 text-ink-muted hover:text-ink text-xs"
          >
            Today
          </button>
          <button
            onClick={() => shift(1)}
            className="px-2 py-1 rounded hover:bg-brand-50 text-ink-muted hover:text-ink text-xs"
            aria-label="Next month"
          >
            →
          </button>
        </div>
      </div>

      {/* Day-of-week header row */}
      <div className="grid grid-cols-7 border-b border-ink-muted/10">
        {dowLabels.map((label) => (
          <div
            key={label}
            className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-ink-muted font-semibold text-center"
          >
            {label}
          </div>
        ))}
      </div>

      {/* 6×7 grid */}
      <div className="grid grid-cols-7 grid-rows-6">
        {cells.map((cell) => {
          const bucket = buckets.get(cell.iso) ?? [];
          const visible = bucket.slice(0, CHIPS_PER_CELL);
          const overflow = bucket.length - visible.length;
          return (
            <div
              key={cell.iso}
              className={`min-h-24 border-e border-b border-ink-muted/10 last:border-e-0 p-1 flex flex-col gap-1 ${
                cell.inMonth
                  ? "bg-white"
                  : "bg-surface-sunken/40 text-ink-muted/60"
              } ${cell.isToday ? "ring-1 ring-brand-400 ring-inset" : ""}`}
            >
              <div className="flex items-center justify-between px-1">
                <span
                  className={`text-xs ${
                    cell.isToday
                      ? "text-brand-600 font-bold"
                      : cell.inMonth
                        ? "text-ink-soft"
                        : "text-ink-muted/60"
                  }`}
                >
                  {cell.date.getUTCDate()}
                </span>
              </div>
              {visible.map((evt, i) => {
                const accent = chipAccent?.(evt.row) ?? "bg-brand-500";
                return (
                  <button
                    key={`${rowKey(evt.row)}-${i}`}
                    onClick={onRowClick ? () => onRowClick(evt.row) : undefined}
                    className={`text-start text-[11px] leading-tight rounded px-1.5 py-0.5 truncate text-white ${accent} hover:opacity-90 active:opacity-80`}
                    title={undefined}
                  >
                    {renderChip(evt.row)}
                  </button>
                );
              })}
              {overflow > 0 && (
                <div className="px-1 text-[10px] text-ink-muted">
                  +{overflow} more
                </div>
              )}
            </div>
          );
        })}
      </div>

      {showEmpty && (
        <div className="p-6 text-center text-sm text-ink-muted">
          {emptyMessage}
        </div>
      )}
    </div>
  );
}
