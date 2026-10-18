"use client";

import { useEffect, useMemo, useState } from "react";
import { DocActivityPanel } from "@lumaara/web-ui";
import { useParams } from "next/navigation";
import { api } from "../../../../lib/api";
import {
  Button,
  Card,
  PageHeader,
  Segmented,
  Skeleton,
  Toast,
} from "../../../../components/ui";

// ── Server payload shape (see /gantt/:projectId) ───────────────────────

interface GanttMilestone {
  id: string;
  name: string;
  dueDate: string | null;
  status: string;
}
interface GanttRow {
  taskId: string;
  subject: string;
  level: number;
  parentTaskId: string | null;
  milestoneId: string | null;
  startDate: string | null;
  endDate: string | null;
  progressPct: number;
  status: string;
  priority: string;
  assignedEmployeeId: string | null;
  assignedEmployeeName?: string | null;
  expectedHours?: number | string | null;
  actualHours?: number | string | null;
}
interface GanttDep {
  id: string;
  fromTaskId: string;
  toTaskId: string;
  type: "FS" | "SS" | "FF" | "SF";
  fromTask?: { id: string; subject: string };
  toTask?: { id: string; subject: string };
}
interface GanttPayload {
  project: { id: string; projectName: string; name: string };
  dateRange: { min: string; max: string };
  milestones: GanttMilestone[];
  rows: GanttRow[];
  dependencies: GanttDep[];
  budget?: { amount: number; spent: number; thresholdPct: number; remaining: number; utilPct: number };
}

type Zoom = "day" | "week" | "month";

const PX_PER_DAY: Record<Zoom, number> = { day: 40, week: 14, month: 4 };
const ROW_HEIGHT = 32;
const LEFT_PANEL_WIDTH = 280;

const STATUS_BAR_BG: Record<string, string> = {
  Open:       "bg-gray-400",
  InProgress: "bg-amber-500",
  Completed:  "bg-green-500",
  Cancelled:  "bg-red-500",
};

function toDayStart(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function daysBetween(a: number, b: number): number {
  return Math.max(0, Math.round((b - a) / 86400_000));
}
function fmt(d: Date, opts: Intl.DateTimeFormatOptions): string {
  return d.toLocaleDateString(undefined, opts);
}

export default function GanttFullPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;

  const [payload, setPayload] = useState<GanttPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<Zoom>("week");

  useEffect(() => {
    api
      .get<GanttPayload>(`/gantt/${projectId}`)
      .then(setPayload)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  }, [projectId]);

  const { minMs, totalDays } = useMemo(() => {
    if (!payload) return { minMs: 0, totalDays: 0 };
    const min = toDayStart(payload.dateRange.min) ?? Date.now();
    const max = toDayStart(payload.dateRange.max) ?? min + 30 * 86400_000;
    return { minMs: min, totalDays: Math.max(1, daysBetween(min, max) + 1) };
  }, [payload]);

  const pxPerDay = PX_PER_DAY[zoom];
  const timelineWidth = totalDays * pxPerDay;

  // Build header ticks based on zoom.
  const headerTicks = useMemo(() => {
    if (!payload) return [];
    const ticks: { left: number; width: number; label: string; sub?: string }[] = [];
    const start = new Date(minMs);
    if (zoom === "day") {
      for (let i = 0; i < totalDays; i++) {
        const d = new Date(minMs + i * 86400_000);
        ticks.push({
          left: i * pxPerDay,
          width: pxPerDay,
          label: fmt(d, { day: "2-digit" }),
          sub: d.getDay() === 1 ? fmt(d, { month: "short" }) : undefined,
        });
      }
    } else if (zoom === "week") {
      // Snap to Monday.
      const first = new Date(start);
      const day = first.getDay(); // 0 = Sun
      const daysToMon = (day + 6) % 7;
      first.setDate(first.getDate() - daysToMon);
      const startOffset = daysBetween(minMs, first.getTime());
      // Iterate weeks until we cover totalDays.
      for (let wk = 0; ; wk++) {
        const weekStart = new Date(first.getTime() + wk * 7 * 86400_000);
        const leftDay = startOffset + wk * 7;
        if (leftDay >= totalDays) break;
        ticks.push({
          left: leftDay * pxPerDay,
          width: 7 * pxPerDay,
          label: `W${weekOfYear(weekStart)}`,
          sub: fmt(weekStart, { month: "short", day: "2-digit" }),
        });
      }
    } else {
      // month
      const first = new Date(start.getFullYear(), start.getMonth(), 1);
      const startOffset = daysBetween(minMs, first.getTime());
      let m = 0;
      while (true) {
        const monthStart = new Date(first.getFullYear(), first.getMonth() + m, 1);
        const nextMonth = new Date(first.getFullYear(), first.getMonth() + m + 1, 1);
        const daysInMonth = Math.round((nextMonth.getTime() - monthStart.getTime()) / 86400_000);
        const leftDay = startOffset + Math.round((monthStart.getTime() - first.getTime()) / 86400_000);
        if (leftDay >= totalDays) break;
        ticks.push({
          left: leftDay * pxPerDay,
          width: daysInMonth * pxPerDay,
          label: fmt(monthStart, { month: "short", year: "2-digit" }),
        });
        m++;
        if (m > 240) break; // safety
      }
    }
    return ticks;
  }, [payload, minMs, totalDays, zoom, pxPerDay]);

  if (error) {
    return (
      <>
        <PageHeader
          breadcrumb={[
            { label: "Projects", href: "/projects/projects" },
            { label: "Gantt" },
          ]}
          title="Gantt"
          actions={
            <Button variant="secondary" onClick={() => history.back()} type="button">
              ← Back
            </Button>
          }
        />
        <Card className="p-4 text-red-700 border-red-200 bg-red-50">{error}</Card>
      </>
    );
  }
  if (!payload) {
    return (
      <>
        <PageHeader
          breadcrumb={[
            { label: "Projects", href: "/projects/projects" },
            { label: "Gantt" },
          ]}
          title="Loading gantt…"
        />
        <Skeleton className="h-96 w-full" rounded="rounded-lg" />
      </>
    );
  }

  // Dependency count per task (fallback when we skip SVG lines).
  const depCountByTask: Record<string, number> = {};
  for (const d of payload.dependencies) {
    depCountByTask[d.toTaskId] = (depCountByTask[d.toTaskId] || 0) + 1;
  }

  // Row lookup for dependency line drawing (index → row).
  const rowIndex: Record<string, number> = {};
  payload.rows.forEach((r, i) => { rowIndex[r.taskId] = i; });

  function barGeometry(row: GanttRow) {
    const s = toDayStart(row.startDate);
    const e = toDayStart(row.endDate);
    if (s == null || e == null) return null;
    const left = daysBetween(minMs, s) * pxPerDay;
    const width = Math.max(pxPerDay * 0.5, (daysBetween(s, e) + 1) * pxPerDay);
    return { left, width };
  }

  const totalHeight = payload.rows.length * ROW_HEIGHT;

  return (
    <>
      <PageHeader
        breadcrumb={[
          { label: "Projects", href: "/projects/projects" },
          { label: payload.project.projectName, href: `/projects/projects/${payload.project.id}` },
          { label: "Gantt" },
        ]}
        title={`${payload.project.projectName} — Timeline`}
        subtitle={
          <span className="text-xs font-mono text-ink-muted">
            {payload.rows.length} tasks · {payload.milestones.length} milestones
          </span>
        }
        actions={
          <>
            <Segmented<Zoom>
              value={zoom}
              onChange={setZoom}
              options={[
                { value: "day",   label: "Day" },
                { value: "week",  label: "Week" },
                { value: "month", label: "Month" },
              ]}
            />
            <Button variant="secondary" onClick={() => history.back()} type="button">
              ← Back
            </Button>
          </>
        }
      />

      {payload.budget && payload.budget.amount > 0 && (
        <div className="mb-3 flex items-center gap-3 text-xs text-ink-muted">
          <span>
            Budget <span className="tabular-nums text-ink">{payload.budget.amount.toFixed(2)}</span>
          </span>
          <span>·</span>
          <span>
            Spent <span className="tabular-nums text-ink">{payload.budget.spent.toFixed(2)}</span>
          </span>
          <span>·</span>
          <span className={payload.budget.utilPct >= payload.budget.thresholdPct ? "text-red-600 font-semibold" : ""}>
            {payload.budget.utilPct.toFixed(1)}% used (threshold {payload.budget.thresholdPct}%)
          </span>
        </div>
      )}

      <Card className="p-0 overflow-hidden">
        <div className="flex" style={{ minHeight: 200 }}>
          {/* LEFT PANEL — task list */}
          <div
            className="shrink-0 border-e border-ink-muted/10 bg-surface-sunken"
            style={{ width: LEFT_PANEL_WIDTH }}
          >
            <div
              className="h-10 border-b border-ink-muted/10 px-3 flex items-center text-[11px] uppercase tracking-wide font-semibold text-ink-muted"
            >
              Task
            </div>
            <div>
              {payload.rows.map((r) => (
                <div
                  key={r.taskId}
                  className="border-b border-ink-muted/5 px-3 flex items-center gap-2 hover:bg-brand-50/50"
                  style={{ height: ROW_HEIGHT, paddingLeft: 12 + r.level * 16 }}
                >
                  <div className="flex-1 truncate text-xs text-ink">
                    <a
                      href={`/projects/tasks?taskId=${r.taskId}`}
                      className="hover:text-brand-700"
                    >
                      {r.subject}
                    </a>
                    {r.assignedEmployeeName && (
                      <span className="ms-1.5 text-[10px] text-ink-muted">· {r.assignedEmployeeName}</span>
                    )}
                  </div>
                  {depCountByTask[r.taskId] ? (
                    <span
                      title={`${depCountByTask[r.taskId]} dependency${depCountByTask[r.taskId] === 1 ? "" : "ies"}`}
                      className="text-[10px] text-brand-600 font-semibold shrink-0"
                    >
                      ⋯{depCountByTask[r.taskId]}
                    </span>
                  ) : null}
                </div>
              ))}
              {payload.rows.length === 0 && (
                <div className="p-4 text-xs text-ink-muted italic">No tasks with dates.</div>
              )}
            </div>
          </div>

          {/* RIGHT PANEL — timeline (scrolls horizontally) */}
          <div className="flex-1 overflow-x-auto">
            <div style={{ width: Math.max(timelineWidth, 400), position: "relative" }}>
              {/* Header ticks */}
              <div
                className="h-10 border-b border-ink-muted/10 relative bg-surface-sunken"
                style={{ width: timelineWidth }}
              >
                {headerTicks.map((t, i) => (
                  <div
                    key={i}
                    className="absolute top-0 bottom-0 border-e border-ink-muted/10 text-[10px] text-ink-muted flex flex-col justify-center px-1"
                    style={{ left: t.left, width: t.width }}
                  >
                    <div className="font-semibold text-ink-soft">{t.label}</div>
                    {t.sub && <div className="text-[9px]">{t.sub}</div>}
                  </div>
                ))}
              </div>

              {/* Rows + bars container */}
              <div className="relative" style={{ width: timelineWidth, height: totalHeight }}>
                {/* Row backgrounds + grid lines */}
                {payload.rows.map((_, i) => (
                  <div
                    key={i}
                    className="absolute start-0 end-0 border-b border-ink-muted/5"
                    style={{ top: i * ROW_HEIGHT, height: ROW_HEIGHT }}
                  />
                ))}

                {/* Milestone diamonds */}
                {payload.milestones.map((m) => {
                  const ms = toDayStart(m.dueDate);
                  if (ms == null) return null;
                  const left = daysBetween(minMs, ms) * pxPerDay;
                  return (
                    <div
                      key={m.id}
                      title={`${m.name} — ${m.status}`}
                      className="absolute top-0 bg-brand-500 shadow-brand-sm"
                      style={{
                        left: left - 6,
                        width: 12,
                        height: 12,
                        transform: "rotate(45deg)",
                        marginTop: 2,
                      }}
                    />
                  );
                })}

                {/* Bars */}
                {payload.rows.map((r, i) => {
                  const g = barGeometry(r);
                  if (!g) return null;
                  const barBg = STATUS_BAR_BG[r.status] ?? "bg-gray-400";
                  const progress = Math.max(0, Math.min(100, r.progressPct ?? 0));
                  return (
                    <div
                      key={r.taskId}
                      className={`absolute rounded ${barBg} shadow-sm`}
                      style={{
                        top: i * ROW_HEIGHT + 6,
                        height: ROW_HEIGHT - 12,
                        left: g.left,
                        width: g.width,
                      }}
                      title={`${r.subject} · ${r.status} · ${Math.round(progress)}%`}
                    >
                      <div
                        className="h-full rounded-s bg-brand-gradient opacity-90"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  );
                })}

                {/* Dependency lines — simple L-shaped SVG */}
                <svg
                  className="absolute inset-0 pointer-events-none"
                  width={timelineWidth}
                  height={totalHeight}
                >
                  {payload.dependencies.map((d) => {
                    const fromRow = payload.rows[rowIndex[d.fromTaskId] ?? -1];
                    const toRow = payload.rows[rowIndex[d.toTaskId] ?? -1];
                    if (!fromRow || !toRow) return null;
                    const gFrom = barGeometry(fromRow);
                    const gTo = barGeometry(toRow);
                    if (!gFrom || !gTo) return null;
                    const fromY = (rowIndex[d.fromTaskId] as number) * ROW_HEIGHT + ROW_HEIGHT / 2;
                    const toY = (rowIndex[d.toTaskId] as number) * ROW_HEIGHT + ROW_HEIGHT / 2;
                    const fromX = gFrom.left + gFrom.width;
                    const toX = gTo.left;
                    const midX = Math.max(fromX + 6, toX - 6);
                    return (
                      <polyline
                        key={d.id}
                        points={`${fromX},${fromY} ${midX},${fromY} ${midX},${toY} ${toX},${toY}`}
                        fill="none"
                        stroke="#a3a3a3"
                        strokeWidth="1"
                        strokeDasharray="3 3"
                      />
                    );
                  })}
                </svg>
              </div>
            </div>
          </div>
        </div>
      </Card>

      {error && (
        <div className="mt-4">
          <Toast kind="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      <div className="rounded-xl border border-ink/10 bg-canvas p-4 mt-6">
        <h3 className="text-sm font-semibold text-ink mb-3">Activity</h3>
        <DocActivityPanel doctype="Gantt" docId={projectId} />
      </div>
    </>
  );
}

// ISO week number.
function weekOfYear(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const diff = (date.getTime() - firstThursday.getTime()) / 86400_000;
  return 1 + Math.round((diff - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
}
