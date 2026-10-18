"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "../../../../components/app-shell";
import { SHELL_NAV } from "../../../../components/shell-nav";
import {
  Button,
  Card,
  Drawer,
  FormField,
  PageHeader,
  Segmented,
  StatusBadge,
  Toast,
  dateShort,
  relativeTime,
} from "../../../../components/ui";

// Admin marketing content calendar.
//
// Three views: Month grid / Week grid / Kanban by status.
// Data comes from crm-service /editorial/calendar?start=&end= (unified feed
// merging EditorialNote + Campaign + Broadcast + SocialPost + WhatsappMessage
// + WebinarEvent). Kanban is EditorialNote-only (only notes are draggable
// between statuses — the other kinds already have their own workflows).
//
// No heavy calendar lib — plain CSS grid.

const CRM_BASE =
  (typeof process !== "undefined" &&
    process.env.NEXT_PUBLIC_CRM_SERVICE_URL) ??
  "/api/crm";

type Kind = "note" | "campaign" | "broadcast" | "social" | "whatsapp" | "webinar";

interface CalendarItem {
  id: string; // "note:xyz", "campaign:abc"
  kind: Kind;
  title: string;
  plannedFor: string;
  status: string;
  channels: string[];
  colorTag?: string;
  href: string;
}

interface NoteRow {
  id: string;
  title: string;
  notes: string | null;
  plannedFor: string;
  channels: string[];
  status: string;
  ownerUserId: string | null;
  colorTag: string | null;
  convertedToDoctype: string | null;
  convertedToDocId: string | null;
}

const KIND_COLORS: Record<Kind, { dot: string; label: string }> = {
  campaign: { dot: "bg-brand-600", label: "Campaign" },
  broadcast: { dot: "bg-brand-500", label: "Broadcast" },
  whatsapp: { dot: "bg-green-500", label: "WhatsApp" },
  social: { dot: "bg-violet-500", label: "Social post" },
  webinar: { dot: "bg-amber-500", label: "Webinar" },
  note: { dot: "bg-gray-400", label: "Note" },
};

const STATUSES = ["Idea", "Planned", "InProgress", "Ready", "Done"] as const;
type NoteStatus = (typeof STATUSES)[number];

// ── Auth helpers (mirror the media-library page) ─────────────────────
function sessionToken(): string {
  if (typeof window === "undefined") return "";
  try {
    const raw = localStorage.getItem("lumaara.session");
    return raw ? (JSON.parse(raw).token as string) : "";
  } catch {
    return "";
  }
}
function clearSessionRedirect() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem("lumaara.session");
  } catch {
    /* ignore */
  }
  if (!window.location.pathname.startsWith("/login")) {
    window.location.href = "/login";
  }
}
async function crmFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = sessionToken();
  const res = await fetch(`${CRM_BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (res.status === 401 && token) clearSessionRedirect();
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  // Guard against HTML/text responses from upstream — raw JSON.parse
  // throws "Unexpected token 'I'" ("Internal Server Error") and buries
  // the real status + body.
  let data: unknown = null;
  if (text) {
    try { data = JSON.parse(text); }
    catch { throw new Error(`Expected JSON but got: ${text.slice(0, 120).replace(/\s+/g, " ")}`); }
  }
  if (!res.ok) {
    const err =
      data && typeof data === "object" && "error" in data
        ? typeof data.error === "string"
          ? data.error
          : JSON.stringify(data.error)
        : `${res.status} ${res.statusText}`;
    throw new Error(err);
  }
  return data as T;
}

// ── Date maths ────────────────────────────────────────────────────────
// Weeks start on Monday to match the ERP convention.
function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay(); // 0=Sun
  const diff = (day + 6) % 7; // days back to Monday
  x.setDate(x.getDate() - diff);
  return x;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}
function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
function fmtMonthYear(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

// ── Page component ────────────────────────────────────────────────────
type View = "Month" | "Week" | "Kanban";

export default function CalendarPage() {
  const [view, setView] = useState<View>("Month");
  const [cursor, setCursor] = useState<Date>(new Date());
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: "success" | "info" | "error"; msg: string } | null>(
    null,
  );

  // New / edit note drawer
  const [noteOpen, setNoteOpen] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState<Partial<NoteRow>>({});

  // Day-detail popover (Month/Week click)
  const [dayDetail, setDayDetail] = useState<Date | null>(null);

  // Convert drawer for a saved note
  const [convertNoteId, setConvertNoteId] = useState<string | null>(null);
  const [convertDoctype, setConvertDoctype] = useState<
    "Campaign" | "Broadcast" | "SocialPost"
  >("Campaign");

  // Compute the range shown by the current view so we know what to fetch.
  const range = useMemo(() => {
    if (view === "Week") {
      const start = startOfWeek(cursor);
      const end = addDays(start, 7);
      return { start, end };
    }
    if (view === "Kanban") {
      // Kanban: last 30 + next 90 days (workspace-y span for a planning tool).
      const start = addDays(new Date(), -30);
      const end = addDays(new Date(), 90);
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
    // Month: pad to the visible grid (6 weeks starting from the Monday of the
    // week containing day 1).
    const first = startOfMonth(cursor);
    const last = endOfMonth(cursor);
    const start = startOfWeek(first);
    const end = addDays(startOfWeek(last), 7 * 6);
    return { start, end };
  }, [view, cursor]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        start: range.start.toISOString(),
        end: range.end.toISOString(),
      });
      const rows = await crmFetch<CalendarItem[]>(`/editorial/calendar?${qs}`);
      setItems(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load calendar");
    } finally {
      setLoading(false);
    }
  }, [range.start, range.end]);

  useEffect(() => {
    load();
  }, [load]);

  function openNewNote(preset?: Partial<NoteRow>) {
    setEditingNoteId(null);
    setNoteDraft({
      title: "",
      notes: "",
      plannedFor: (preset?.plannedFor ?? new Date().toISOString()) as string,
      channels: (preset?.channels as string[]) ?? ["Email"],
      status: "Idea",
      ownerUserId: null,
      colorTag: null,
      ...preset,
    });
    setNoteOpen(true);
  }

  async function openEditNote(id: string) {
    try {
      const n = await crmFetch<NoteRow>(`/editorial/notes/${id}`);
      setEditingNoteId(id);
      setNoteDraft({
        ...n,
        plannedFor: n.plannedFor,
      });
      setNoteOpen(true);
    } catch (e) {
      setToast({ kind: "error", msg: e instanceof Error ? e.message : "Failed" });
    }
  }

  async function saveNote() {
    try {
      const payload = {
        title: noteDraft.title ?? "",
        notes: noteDraft.notes ?? null,
        plannedFor: noteDraft.plannedFor,
        channels: noteDraft.channels ?? [],
        status: noteDraft.status ?? "Idea",
        ownerUserId: noteDraft.ownerUserId ?? null,
        colorTag: noteDraft.colorTag ?? null,
      };
      if (editingNoteId) {
        await crmFetch<NoteRow>(`/editorial/notes/${editingNoteId}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        setToast({ kind: "success", msg: "Note updated" });
      } else {
        await crmFetch<NoteRow>(`/editorial/notes`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        setToast({ kind: "success", msg: "Note created" });
      }
      setNoteOpen(false);
      await load();
    } catch (e) {
      setToast({ kind: "error", msg: e instanceof Error ? e.message : "Save failed" });
    }
  }

  async function moveNoteToStatus(item: CalendarItem, next: NoteStatus) {
    if (item.kind !== "note") return;
    const rawId = item.id.slice("note:".length);
    try {
      await crmFetch<NoteRow>(`/editorial/notes/${rawId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: next }),
      });
      // Optimistic update.
      setItems((rows) =>
        rows.map((r) => (r.id === item.id ? { ...r, status: next } : r)),
      );
    } catch (e) {
      setToast({ kind: "error", msg: e instanceof Error ? e.message : "Move failed" });
      await load(); // resync
    }
  }

  async function convertNote() {
    if (!convertNoteId) return;
    try {
      const res = await crmFetch<{ note: NoteRow; doc: { id: string } }>(
        `/editorial/notes/${convertNoteId}/convert`,
        { method: "POST", body: JSON.stringify({ doctype: convertDoctype }) },
      );
      setToast({
        kind: "success",
        msg: `Converted to ${convertDoctype} — id ${res.doc.id}`,
      });
      setConvertNoteId(null);
      setNoteOpen(false);
      await load();
    } catch (e) {
      setToast({
        kind: "error",
        msg: e instanceof Error ? e.message : "Convert failed",
      });
    }
  }

  return (
    <AppShell moduleName="Home" nav={SHELL_NAV}>
      <PageHeader
        title="Content calendar"
        subtitle="Everything your marketing team has planned — notes, campaigns, broadcasts, social, WhatsApp, webinars."
        breadcrumb={[
          { label: "Admin", href: "/admin" },
          { label: "Marketing", href: "/admin/marketing" },
          { label: "Content calendar" },
        ]}
        actions={
          <>
            <Button variant="secondary" onClick={() => history.back()}>
              ← Back
            </Button>
            <Button variant="brand" onClick={() => openNewNote()}>
              + New note
            </Button>
          </>
        }
      />

      {error && (
        <div className="mb-4">
          <Toast kind="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}
      {toast && (
        <div className="mb-4">
          <Toast kind={toast.kind} message={toast.msg} onDismiss={() => setToast(null)} />
        </div>
      )}

      <Card className="p-3 mb-4 flex flex-wrap items-center gap-3">
        <Segmented<View>
          value={view}
          onChange={setView}
          options={[
            { value: "Month", label: "Month" },
            { value: "Week", label: "Week" },
            { value: "Kanban", label: "Kanban" },
          ]}
        />
        {view !== "Kanban" && (
          <>
            <Button
              variant="ghost"
              onClick={() => {
                if (view === "Week") setCursor((d) => addDays(d, -7));
                else setCursor((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1));
              }}
            >
              ←
            </Button>
            <div className="text-sm font-medium text-ink min-w-[160px] text-center">
              {view === "Week"
                ? `Week of ${dateShort(startOfWeek(cursor).toISOString())}`
                : fmtMonthYear(cursor)}
            </div>
            <Button
              variant="ghost"
              onClick={() => {
                if (view === "Week") setCursor((d) => addDays(d, 7));
                else setCursor((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1));
              }}
            >
              →
            </Button>
            <Button variant="secondary" onClick={() => setCursor(new Date())}>
              Today
            </Button>
          </>
        )}
        <div className="flex-1" />
        <div className="flex items-center gap-3 text-xs text-ink-muted flex-wrap">
          {(Object.keys(KIND_COLORS) as Kind[]).map((k) => (
            <span key={k} className="inline-flex items-center gap-1">
              <span className={`w-2 h-2 rounded-full ${KIND_COLORS[k].dot}`} />
              {KIND_COLORS[k].label}
            </span>
          ))}
        </div>
      </Card>

      {loading ? (
        <Card className="p-8 text-ink-muted text-sm">Loading…</Card>
      ) : view === "Month" ? (
        <MonthGrid
          cursor={cursor}
          items={items}
          onDayClick={(d) => setDayDetail(d)}
          onItemClick={(item) => {
            if (item.kind === "note") openEditNote(item.id.slice("note:".length));
            else window.location.href = item.href;
          }}
        />
      ) : view === "Week" ? (
        <WeekGrid
          cursor={cursor}
          items={items}
          onItemClick={(item) => {
            if (item.kind === "note") openEditNote(item.id.slice("note:".length));
            else window.location.href = item.href;
          }}
        />
      ) : (
        <KanbanBoard
          items={items}
          onCardClick={(item) => openEditNote(item.id.slice("note:".length))}
          onDrop={moveNoteToStatus}
          onAddInStatus={(status) => {
            const now = new Date();
            openNewNote({ status, plannedFor: now.toISOString() });
          }}
        />
      )}

      {/* Day detail popover (compact list of items on the clicked day) */}
      <Drawer
        open={!!dayDetail}
        onClose={() => setDayDetail(null)}
        title={dayDetail ? dateShort(dayDetail.toISOString()) : ""}
        width="w-[420px]"
        footer={
          <Button
            variant="brand"
            onClick={() => {
              const d = dayDetail ?? new Date();
              d.setHours(9, 0, 0, 0);
              openNewNote({ plannedFor: d.toISOString() });
              setDayDetail(null);
            }}
          >
            + New note on this day
          </Button>
        }
      >
        {dayDetail && (
          <DayList
            day={dayDetail}
            items={items}
            onClick={(item) => {
              if (item.kind === "note")
                openEditNote(item.id.slice("note:".length));
              else window.location.href = item.href;
            }}
          />
        )}
      </Drawer>

      {/* Note create/edit drawer */}
      <Drawer
        open={noteOpen}
        onClose={() => setNoteOpen(false)}
        title={editingNoteId ? "Edit note" : "New note"}
        footer={
          <>
            {editingNoteId && (
              <Button
                variant="ghost"
                onClick={() => setConvertNoteId(editingNoteId)}
              >
                Convert…
              </Button>
            )}
            <Button variant="secondary" onClick={() => setNoteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="brand"
              onClick={saveNote}
              disabled={!noteDraft.title || !noteDraft.plannedFor}
            >
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <FormField label="Title" required>
            <input
              className="input"
              value={noteDraft.title ?? ""}
              onChange={(e) => setNoteDraft((d) => ({ ...d, title: e.target.value }))}
              autoFocus
            />
          </FormField>
          <FormField label="Planned for" required>
            <input
              type="datetime-local"
              className="input"
              value={toLocalInput(noteDraft.plannedFor)}
              onChange={(e) =>
                setNoteDraft((d) => ({
                  ...d,
                  plannedFor: new Date(e.target.value).toISOString(),
                }))
              }
            />
          </FormField>
          <FormField label="Channels">
            <div className="flex flex-wrap gap-2">
              {["Email", "SocialPost", "WhatsApp", "SMS"].map((c) => {
                const on = (noteDraft.channels ?? []).includes(c);
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() =>
                      setNoteDraft((d) => {
                        const cur = new Set(d.channels ?? []);
                        if (cur.has(c)) cur.delete(c);
                        else cur.add(c);
                        return { ...d, channels: Array.from(cur) };
                      })
                    }
                    className={`px-2 py-1 rounded text-xs border ${
                      on
                        ? "border-brand-500 bg-brand-50 text-brand-700"
                        : "border-ink-muted/20 text-ink-muted hover:border-ink-muted/40"
                    }`}
                  >
                    {c}
                  </button>
                );
              })}
            </div>
          </FormField>
          <FormField label="Status">
            <select
              className="input"
              value={noteDraft.status ?? "Idea"}
              onChange={(e) => setNoteDraft((d) => ({ ...d, status: e.target.value }))}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Owner user ID (optional)">
            <input
              className="input"
              value={noteDraft.ownerUserId ?? ""}
              onChange={(e) =>
                setNoteDraft((d) => ({ ...d, ownerUserId: e.target.value || null }))
              }
              placeholder="user id"
            />
          </FormField>
          <FormField label="Color tag (optional)">
            <input
              className="input"
              value={noteDraft.colorTag ?? ""}
              onChange={(e) =>
                setNoteDraft((d) => ({ ...d, colorTag: e.target.value || null }))
              }
              placeholder="e.g. launch, monthly"
            />
          </FormField>
          <FormField label="Notes">
            <textarea
              className="input min-h-[120px]"
              value={noteDraft.notes ?? ""}
              onChange={(e) => setNoteDraft((d) => ({ ...d, notes: e.target.value }))}
            />
          </FormField>
        </div>
      </Drawer>

      {/* Convert drawer */}
      <Drawer
        open={!!convertNoteId}
        onClose={() => setConvertNoteId(null)}
        title="Convert to document"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConvertNoteId(null)}>
              Cancel
            </Button>
            <Button variant="brand" onClick={convertNote}>
              Convert
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-ink-muted">
            Seed a new Campaign / Broadcast / SocialPost from this note. The note stays on the
            calendar with a link to the underlying doc and status = Done.
          </p>
          <FormField label="Target doctype" required>
            <select
              className="input"
              value={convertDoctype}
              onChange={(e) =>
                setConvertDoctype(e.target.value as "Campaign" | "Broadcast" | "SocialPost")
              }
            >
              <option value="Campaign">Campaign (email)</option>
              <option value="Broadcast">Broadcast</option>
              <option value="SocialPost">Social post</option>
            </select>
          </FormField>
        </div>
      </Drawer>
    </AppShell>
  );
}

// ── Month grid ────────────────────────────────────────────────────────
function MonthGrid({
  cursor,
  items,
  onDayClick,
  onItemClick,
}: {
  cursor: Date;
  items: CalendarItem[];
  onDayClick: (d: Date) => void;
  onItemClick: (item: CalendarItem) => void;
}) {
  const first = startOfMonth(cursor);
  const gridStart = startOfWeek(first);
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) days.push(addDays(gridStart, i));
  const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  const itemsByDay = new Map<string, CalendarItem[]>();
  for (const it of items) {
    const key = dayKey(new Date(it.plannedFor));
    const list = itemsByDay.get(key) ?? [];
    list.push(it);
    itemsByDay.set(key, list);
  }

  return (
    <Card className="p-2">
      <div className="grid grid-cols-7 text-[11px] font-medium text-ink-muted uppercase tracking-wide border-b border-ink-muted/10 mb-1">
        {dayLabels.map((d) => (
          <div key={d} className="px-2 py-1">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px bg-ink-muted/10 rounded overflow-hidden">
        {days.map((d) => {
          const inMonth = d.getMonth() === cursor.getMonth();
          const today = isSameDay(d, new Date());
          const dayItems = itemsByDay.get(dayKey(d)) ?? [];
          return (
            <button
              key={dayKey(d)}
              onClick={() => onDayClick(d)}
              className={`min-h-[92px] p-1 text-start bg-white hover:bg-surface-sunken transition ${
                inMonth ? "" : "opacity-40"
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <div
                  className={`text-[11px] font-medium ${
                    today
                      ? "bg-brand-600 text-white rounded-full w-5 h-5 grid place-items-center"
                      : "text-ink-soft"
                  }`}
                >
                  {d.getDate()}
                </div>
              </div>
              <div className="space-y-0.5">
                {dayItems.slice(0, 3).map((it) => (
                  <div
                    key={it.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      onItemClick(it);
                    }}
                    className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-brand-50 cursor-pointer"
                    title={`${KIND_COLORS[it.kind].label}: ${it.title}`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${KIND_COLORS[it.kind].dot}`} />
                    <span className="text-[11px] text-ink truncate">{it.title}</span>
                  </div>
                ))}
                {dayItems.length > 3 && (
                  <div className="text-[10px] text-ink-muted ps-2">
                    +{dayItems.length - 3} more
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

// ── Week grid ─────────────────────────────────────────────────────────
function WeekGrid({
  cursor,
  items,
  onItemClick,
}: {
  cursor: Date;
  items: CalendarItem[];
  onItemClick: (item: CalendarItem) => void;
}) {
  const start = startOfWeek(cursor);
  const days: Date[] = [];
  for (let i = 0; i < 7; i++) days.push(addDays(start, i));

  const itemsByDay = new Map<string, CalendarItem[]>();
  for (const it of items) {
    const key = dayKey(new Date(it.plannedFor));
    const list = itemsByDay.get(key) ?? [];
    list.push(it);
    itemsByDay.set(key, list);
  }

  return (
    <Card className="p-2">
      <div className="grid grid-cols-7 gap-2">
        {days.map((d) => {
          const dayItems = itemsByDay.get(dayKey(d)) ?? [];
          const today = isSameDay(d, new Date());
          return (
            <div
              key={dayKey(d)}
              className="min-h-[400px] rounded border border-ink-muted/10 bg-white p-2"
            >
              <div
                className={`text-xs font-medium mb-2 flex items-center gap-2 ${
                  today ? "text-brand-600" : "text-ink-soft"
                }`}
              >
                <span className="uppercase">
                  {d.toLocaleDateString(undefined, { weekday: "short" })}
                </span>
                <span
                  className={`${
                    today
                      ? "bg-brand-600 text-white rounded-full w-5 h-5 grid place-items-center"
                      : ""
                  }`}
                >
                  {d.getDate()}
                </span>
              </div>
              <div className="space-y-1">
                {dayItems.map((it) => (
                  <button
                    key={it.id}
                    onClick={() => onItemClick(it)}
                    className="w-full text-start rounded px-2 py-1 bg-surface-sunken hover:bg-brand-50 border border-ink-muted/10 hover:border-brand-300 transition"
                  >
                    <div className="flex items-center gap-1">
                      <span className={`w-1.5 h-1.5 rounded-full ${KIND_COLORS[it.kind].dot}`} />
                      <span className="text-[11px] font-medium text-ink truncate">
                        {it.title}
                      </span>
                    </div>
                    <div className="text-[10px] text-ink-muted mt-0.5 tabular-nums">
                      {new Date(it.plannedFor).toLocaleTimeString(undefined, {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                  </button>
                ))}
                {dayItems.length === 0 && (
                  <div className="text-[11px] text-ink-muted italic pt-2">Nothing planned</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ── Kanban board (notes-only) ────────────────────────────────────────
function KanbanBoard({
  items,
  onCardClick,
  onDrop,
  onAddInStatus,
}: {
  items: CalendarItem[];
  onCardClick: (item: CalendarItem) => void;
  onDrop: (item: CalendarItem, next: NoteStatus) => void;
  onAddInStatus: (status: NoteStatus) => void;
}) {
  const notes = items.filter((i) => i.kind === "note");
  const byStatus = new Map<string, CalendarItem[]>();
  for (const s of STATUSES) byStatus.set(s, []);
  for (const n of notes) {
    const list = byStatus.get(n.status) ?? byStatus.get("Idea")!;
    list.push(n);
  }

  const [dragging, setDragging] = useState<CalendarItem | null>(null);

  return (
    <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
      {STATUSES.map((s) => {
        const list = byStatus.get(s) ?? [];
        return (
          <div
            key={s}
            className="rounded border border-ink-muted/10 bg-surface-sunken p-2 min-h-[280px]"
            onDragOver={(e) => {
              if (dragging) e.preventDefault();
            }}
            onDrop={() => {
              if (dragging) {
                onDrop(dragging, s);
                setDragging(null);
              }
            }}
          >
            <div className="flex items-center justify-between mb-2 px-1">
              <div className="text-xs font-semibold text-ink-soft uppercase tracking-wide">
                {s}
                <span className="ms-1 text-ink-muted">({list.length})</span>
              </div>
              <button
                onClick={() => onAddInStatus(s)}
                className="text-xs text-brand-600 hover:text-brand-700"
                title={`New note in ${s}`}
              >
                +
              </button>
            </div>
            <div className="space-y-2">
              {list.map((it) => (
                <div
                  key={it.id}
                  draggable
                  onDragStart={() => setDragging(it)}
                  onDragEnd={() => setDragging(null)}
                  onClick={() => onCardClick(it)}
                  className="rounded bg-white border border-ink-muted/10 p-2 cursor-grab hover:shadow-brand-glow transition"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-sm font-medium text-ink line-clamp-2">{it.title}</div>
                    {it.colorTag && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-brand-50 text-brand-700 shrink-0">
                        {it.colorTag}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-ink-muted">
                    <span className="tabular-nums" title={dateShort(it.plannedFor)}>
                      {relativeTime(it.plannedFor)}
                    </span>
                    {it.channels.map((c) => (
                      <span
                        key={c}
                        className="px-1 py-0.5 rounded bg-surface-sunken border border-ink-muted/10"
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
              {list.length === 0 && (
                <div className="text-[11px] text-ink-muted italic px-1 py-2">Drop notes here</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Day-detail list (used in the drawer) ─────────────────────────────
function DayList({
  day,
  items,
  onClick,
}: {
  day: Date;
  items: CalendarItem[];
  onClick: (item: CalendarItem) => void;
}) {
  const dayItems = items.filter((i) => isSameDay(new Date(i.plannedFor), day));
  if (dayItems.length === 0) {
    return <div className="text-ink-muted text-sm">Nothing planned on this day yet.</div>;
  }
  return (
    <div className="space-y-2">
      {dayItems.map((it) => (
        <button
          key={it.id}
          onClick={() => onClick(it)}
          className="w-full text-start rounded border border-ink-muted/10 bg-white hover:bg-surface-sunken p-2 transition"
        >
          <div className="flex items-center gap-2">
            <span className={`w-1.5 h-1.5 rounded-full ${KIND_COLORS[it.kind].dot}`} />
            <span className="text-sm font-medium text-ink truncate flex-1">{it.title}</span>
            <StatusBadge status={it.status} />
          </div>
          <div className="mt-1 text-[11px] text-ink-muted flex items-center gap-2">
            <span>{KIND_COLORS[it.kind].label}</span>
            <span>·</span>
            <span className="tabular-nums">
              {new Date(it.plannedFor).toLocaleTimeString(undefined, {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            {it.channels.length > 0 && (
              <>
                <span>·</span>
                <span>{it.channels.join(", ")}</span>
              </>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}

// ── Small utilities ──────────────────────────────────────────────────
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

// datetime-local expects "YYYY-MM-DDTHH:mm" in *local* time.
function toLocalInput(iso: string | undefined | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
