"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { Button, Drawer, FormField, dateShort } from "./ui";
import { Icon } from "./app-shell";

// ActivityTimeline — the Zoho-CRM-style unified feed shown at the bottom of
// every CRM record page (Lead, Opportunity, Customer, Deal, etc.).
//
// Renders a chronological log of Tasks / Calls / Meetings / Notes / Emails,
// with quick-add buttons at the top and inline complete/reopen actions per
// row. Talks to `/activities/timeline/:type/:id` for read and `/activities`
// for writes. Poll-free — reload after every write.

export interface Activity {
  id: string;
  type: "Task" | "Call" | "Meeting" | "Note" | "Email";
  subject: string;
  description: string | null;
  parentType: string;
  parentId: string;
  priority: "Low" | "Medium" | "High" | null;
  status: "Open" | "Completed" | "Cancelled" | "Overdue";
  dueDate: string | null;
  completedAt: string | null;
  callDirection: "Inbound" | "Outbound" | null;
  callDuration: number | null;
  callOutcome: string | null;
  phoneNumber: string | null;
  startAt: string | null;
  endAt: string | null;
  location: string | null;
  meetingUrl: string | null;
  emailFrom: string | null;
  emailTo: string | null;
  emailCc: string | null;
  ownerUserId: string;
  assigneeUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Props {
  parentType: string;
  parentId: string;
  /** Optional — filter the timeline down to one activity type. */
  onlyType?: Activity["type"];
}

const TYPE_META: Record<Activity["type"], { label: string; badge: string; icon: React.ReactNode }> = {
  Task:    { label: "Task",    badge: "badge-brand",  icon: Icon.clipboard },
  Call:    { label: "Call",    badge: "badge-blue",   icon: Icon.megaphone },
  Meeting: { label: "Meeting", badge: "badge-violet", icon: Icon.calendar },
  Note:    { label: "Note",    badge: "badge-gray",   icon: Icon.book },
  Email:   { label: "Email",   badge: "badge-amber",  icon: Icon.send },
};

const PRIORITY_BADGE: Record<string, string> = {
  Low: "badge-gray", Medium: "badge-amber", High: "badge-red",
};

// Small helper — format ISO date+time as "12 Aug, 3:45 PM" (or falls back).
function whenLabel(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    day: "numeric", month: "short",
    hour: "numeric", minute: "2-digit",
  });
}

export function ActivityTimeline({ parentType, parentId, onlyType }: Props) {
  const [rows, setRows] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState<Activity["type"] | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get<Activity[]>(
        `/activities/timeline/${parentType}/${parentId}`,
      );
      setRows(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load activities");
    } finally {
      setLoading(false);
    }
  }, [parentType, parentId]);
  useEffect(() => { load(); }, [load]);

  const filtered = onlyType ? rows.filter((r) => r.type === onlyType) : rows;

  async function toggleComplete(row: Activity) {
    const action = row.status === "Completed" ? "reopen" : "complete";
    await api.post(`/activities/${row.id}/${action}`, {});
    await load();
  }

  async function remove(row: Activity) {
    if (!confirm(`Delete this ${row.type.toLowerCase()}?`)) return;
    await api.del(`/activities/${row.id}`);
    await load();
  }

  const openCount = useMemo(
    () => rows.filter((r) => r.status === "Open").length,
    [rows],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink">
          Activity {openCount > 0 && <span className="badge-brand ms-1">{openCount} open</span>}
        </h3>
        <div className="flex items-center gap-1">
          {(["Email", "Task", "Call", "Meeting", "Note"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setShowForm(t)}
              className={t === "Email" ? "btn-brand btn-sm" : "btn-secondary btn-sm"}
            >
              + {t}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="text-sm text-red-600">{error}</div>}

      {loading ? (
        <div className="text-sm text-ink-muted">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="card p-6 text-center text-sm text-ink-muted">
          No activity yet — log a call, schedule a meeting, or add a note.
        </div>
      ) : (
        <ol className="relative border-s-2 border-ink-muted/15 ps-6 space-y-4">
          {filtered.map((row) => {
            const meta = TYPE_META[row.type];
            const done = row.status === "Completed";
            return (
              <li key={row.id} className="relative">
                <span className="absolute -left-[35px] top-1 h-6 w-6 rounded-full bg-white ring-2 ring-brand-200 grid place-items-center text-brand-600">
                  {meta.icon}
                </span>
                <div className={`card p-3 ${done ? "opacity-60" : ""}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={meta.badge}>{meta.label}</span>
                        {row.priority && <span className={PRIORITY_BADGE[row.priority]}>{row.priority}</span>}
                        {row.status === "Completed" && <span className="badge-green">Done</span>}
                        {row.status === "Cancelled" && <span className="badge-gray">Cancelled</span>}
                      </div>
                      <div className={`text-sm font-medium mt-1 ${done ? "line-through" : ""}`}>
                        {row.subject}
                      </div>
                      {row.description && (
                        <div className="text-xs text-ink-soft mt-1 whitespace-pre-wrap">{row.description}</div>
                      )}
                      <div className="text-[11px] text-ink-muted mt-2 flex flex-wrap gap-x-3 gap-y-1">
                        {row.dueDate && <span>Due {whenLabel(row.dueDate)}</span>}
                        {row.startAt && <span>Starts {whenLabel(row.startAt)}</span>}
                        {row.callDirection && <span>{row.callDirection}</span>}
                        {row.callDuration != null && <span>{Math.round(row.callDuration / 60)} min</span>}
                        {row.location && <span>@ {row.location}</span>}
                        {row.emailTo && <span>To {row.emailTo}</span>}
                        <span>Logged {dateShort(row.createdAt)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {row.type !== "Note" && row.type !== "Email" && (
                        <button
                          onClick={() => toggleComplete(row)}
                          className="text-xs text-brand-600 hover:underline"
                        >
                          {row.status === "Completed" ? "Reopen" : "Complete"}
                        </button>
                      )}
                      <button
                        onClick={() => remove(row)}
                        className="text-xs text-red-600 hover:underline"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {showForm && (
        <ActivityForm
          type={showForm}
          parentType={parentType}
          parentId={parentId}
          onClose={() => setShowForm(null)}
          onSaved={async () => {
            setShowForm(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

// ─── Create form (drawer) — type-aware fields ───────────────────────────

function ActivityForm({
  type, parentType, parentId, onClose, onSaved,
}: {
  type: Activity["type"];
  parentType: string;
  parentId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<{
    subject: string;
    description: string;
    priority: "Low" | "Medium" | "High";
    dueDate: string;
    callDirection: "Inbound" | "Outbound";
    callDuration: string;
    callOutcome: string;
    phoneNumber: string;
    startAt: string;
    endAt: string;
    location: string;
    meetingUrl: string;
    emailTo: string;
    emailCc: string;
  }>({
    subject: "",
    description: "",
    priority: "Medium",
    dueDate: "",
    callDirection: "Outbound",
    callDuration: "",
    callOutcome: "Answered",
    phoneNumber: "",
    startAt: "",
    endAt: "",
    location: "",
    meetingUrl: "",
    emailTo: "",
    emailCc: "",
  });

  // Auto-fetch the parent's email address for Email compose. Best-effort —
  // if the fetch fails or the record has no email, the user just fills in
  // the To field manually.
  useEffect(() => {
    if (type !== "Email") return;
    const path =
      parentType === "Lead" ? `/leads/${parentId}`
      : parentType === "Customer" ? `/customers/${parentId}`
      : parentType === "Opportunity" ? `/opportunities/${parentId}`
      : null;
    if (!path) return;
    api.get<{ email?: string | null }>(path)
      .then((r) => {
        if (r.email) setForm((f) => ({ ...f, emailTo: r.email! }));
      })
      .catch(() => { /* silent */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        type,
        parentType,
        parentId,
        subject: form.subject.trim(),
        description: form.description.trim() || null,
      };
      if (type === "Task") {
        payload.priority = form.priority;
        payload.dueDate = form.dueDate ? new Date(form.dueDate).toISOString() : null;
      }
      if (type === "Call") {
        payload.callDirection = form.callDirection;
        payload.callOutcome = form.callOutcome || null;
        payload.phoneNumber = form.phoneNumber || null;
        payload.callDuration = form.callDuration ? Number(form.callDuration) * 60 : null;
      }
      if (type === "Meeting") {
        if (!form.startAt) throw new Error("Meeting requires a start time");
        payload.startAt = new Date(form.startAt).toISOString();
        payload.endAt = form.endAt ? new Date(form.endAt).toISOString() : null;
        payload.location = form.location || null;
        payload.meetingUrl = form.meetingUrl || null;
        payload.status = "Open";
      }
      if (type === "Email") {
        if (!form.emailTo.trim()) throw new Error("Email requires a To address");
        payload.emailTo = form.emailTo.trim();
        payload.emailCc = form.emailCc.trim() || null;
        // Emails are logged as completed sends — the sent-at is "now".
        payload.status = "Completed";
      }
      await api.post("/activities", payload);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={`Log ${type.toLowerCase()}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            variant="brand"
            onClick={(e) => save(e as unknown as React.FormEvent)}
            disabled={busy || !form.subject.trim()}
          >
            {busy ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <form onSubmit={save} className="space-y-4">
        {error && <div className="rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>}

        <FormField label="Subject" required>
          <input
            className="input"
            value={form.subject}
            onChange={(e) => setForm({ ...form, subject: e.target.value })}
            placeholder={
              type === "Task" ? "e.g. Send proposal deck"
              : type === "Call" ? "e.g. Discovery call - pricing"
              : type === "Meeting" ? "e.g. Product demo"
              : "Note title"
            }
            autoFocus
            required
          />
        </FormField>

        {type === "Task" && (
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Priority">
              <select
                className="input"
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value as "Low" | "Medium" | "High" })}
              >
                <option>Low</option><option>Medium</option><option>High</option>
              </select>
            </FormField>
            <FormField label="Due">
              <input
                type="datetime-local"
                className="input"
                value={form.dueDate}
                onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
              />
            </FormField>
          </div>
        )}

        {type === "Call" && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Direction">
                <select
                  className="input"
                  value={form.callDirection}
                  onChange={(e) => setForm({ ...form, callDirection: e.target.value as "Inbound" | "Outbound" })}
                >
                  <option>Outbound</option><option>Inbound</option>
                </select>
              </FormField>
              <FormField label="Outcome">
                <select
                  className="input"
                  value={form.callOutcome}
                  onChange={(e) => setForm({ ...form, callOutcome: e.target.value })}
                >
                  <option>Answered</option>
                  <option>NoAnswer</option>
                  <option>Busy</option>
                  <option>Voicemail</option>
                  <option>WrongNumber</option>
                </select>
              </FormField>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Duration (min)">
                <input
                  type="number"
                  min={0}
                  className="input"
                  value={form.callDuration}
                  onChange={(e) => setForm({ ...form, callDuration: e.target.value })}
                />
              </FormField>
              <FormField label="Phone number">
                <input
                  className="input"
                  value={form.phoneNumber}
                  onChange={(e) => setForm({ ...form, phoneNumber: e.target.value })}
                />
              </FormField>
            </div>
          </>
        )}

        {type === "Meeting" && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Start" required>
                <input
                  type="datetime-local"
                  className="input"
                  value={form.startAt}
                  onChange={(e) => setForm({ ...form, startAt: e.target.value })}
                  required
                />
              </FormField>
              <FormField label="End">
                <input
                  type="datetime-local"
                  className="input"
                  value={form.endAt}
                  onChange={(e) => setForm({ ...form, endAt: e.target.value })}
                />
              </FormField>
            </div>
            <FormField label="Location">
              <input
                className="input"
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                placeholder="Office / Zoom / Meet…"
              />
            </FormField>
            <FormField label="Meeting URL">
              <input
                className="input"
                value={form.meetingUrl}
                onChange={(e) => setForm({ ...form, meetingUrl: e.target.value })}
                placeholder="https://zoom.us/…"
              />
            </FormField>
          </>
        )}

        {type === "Email" && (
          <>
            <FormField label="To" required>
              <input
                type="email"
                className="input"
                value={form.emailTo}
                onChange={(e) => setForm({ ...form, emailTo: e.target.value })}
                placeholder="prospect@company.com"
                required
              />
            </FormField>
            <FormField label="Cc">
              <input
                className="input"
                value={form.emailCc}
                onChange={(e) => setForm({ ...form, emailCc: e.target.value })}
                placeholder="Optional, comma-separated"
              />
            </FormField>
          </>
        )}

        <FormField label={type === "Note" ? "Note" : type === "Email" ? "Message" : "Description"}>
          <textarea
            className="input min-h-[120px]"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder={
              type === "Note" ? "What did you learn?"
              : type === "Email" ? "Type your message…"
              : "Optional details…"
            }
          />
        </FormField>

        <button type="submit" className="hidden" />
      </form>
    </Drawer>
  );
}
