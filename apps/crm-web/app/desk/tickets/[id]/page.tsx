"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DocActivityPanel } from "@lumaara/web-ui";
import { useParams, useRouter } from "next/navigation";
import { api } from "../../../../lib/api";
import {
  Button,
  Card,
  CardHeader,
  Drawer,
  Field,
  FormField,
  PageHeader,
  SectionHeader,
  Toast,
  dateShort,
  relativeTime,
} from "../../../../components/ui";
import { Icon } from "../../../../components/app-shell";
import {
  PriorityBadge,
  SlaIndicator,
  TicketStatusBadge,
  fetchDeskUsers,
  type DeskUser,
  type TicketPriority,
  type TicketStatus,
} from "../../_lib/ui";

// Desk ticket detail — Zoho-style split layout. Left column shows the
// conversation timeline + reply composer, right column exposes editable
// properties (status/priority/type/assignee/tags). Status/assignee changes
// hit dedicated endpoints; the rest go through the generic PUT.

type TicketType = "Question" | "Incident" | "Problem" | "FeatureRequest" | "Task";
type ReplyDirection = "Public" | "Private";

interface Reply {
  id: string;
  direction: ReplyDirection | "System";
  authorType: "Agent" | "Requester" | "System" | string;
  authorName: string | null;
  body: string;
  createdAt: string;
}

interface TimeEntry {
  minutes: number;
  notes: string | null;
  billable: boolean;
  startedAt: string;
}

interface Csat {
  score: number;
  comment: string | null;
  ratedAt: string;
}

interface SlaPolicyRef {
  id: string;
  name: string;
}

interface TicketDetail {
  id: string;
  name: string;
  subject: string;
  description: string | null;
  status: TicketStatus;
  priority: TicketPriority;
  type: TicketType;
  channel: string;
  requesterEmail: string | null;
  requesterName: string | null;
  requesterPhone: string | null;
  assigneeUserId: string | null;
  linkedCustomerId: string | null;
  linkedLeadId: string | null;
  tags: string[] | null;
  firstResponseDueAt: string | null;
  resolutionDueAt: string | null;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  slaFirstResponseBreached: boolean;
  slaResolutionBreached: boolean;
  createdAt: string;
  updatedAt?: string;
  replies: Reply[];
  timeEntries: TimeEntry[];
  csatRating: Csat | null;
  slaPolicy: SlaPolicyRef | null;
}

interface CannedResponse {
  id: string;
  name: string;
  category: string | null;
  subject: string | null;
  body: string;
}

// Reply bubble — differentiates Public (customer-visible, white card), Private
// (internal note, amber-tinted with a pill), and System events (centered).
function ReplyCard({ reply }: { reply: Reply }) {
  if (reply.direction === "System" || reply.authorType === "System") {
    return (
      <div className="flex justify-center my-2">
        <span className="text-[11px] text-ink-muted bg-surface-sunken rounded-full px-3 py-1">
          {reply.body}
        </span>
      </div>
    );
  }
  const isPrivate = reply.direction === "Private";
  return (
    <div
      className={`rounded-lg border p-3 ${
        isPrivate
          ? "bg-amber-50/70 border-amber-200"
          : "bg-white border-ink-muted/10 border-s-4 border-s-blue-400"
      }`}
    >
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <div className="h-6 w-6 rounded-full bg-brand-100 text-brand-700 grid place-items-center text-[10px] font-bold shrink-0">
            {(reply.authorName || "?").trim().charAt(0).toUpperCase()}
          </div>
          <span className="text-sm font-medium text-ink truncate">
            {reply.authorName || (reply.authorType === "Requester" ? "Requester" : "Agent")}
          </span>
          {isPrivate && (
            <span className="badge-amber">Internal note</span>
          )}
        </div>
        <span
          className="text-[11px] text-ink-muted shrink-0"
          title={new Date(reply.createdAt).toLocaleString()}
        >
          {relativeTime(reply.createdAt)}
        </span>
      </div>
      <div className="text-sm text-ink whitespace-pre-wrap break-words">
        {reply.body}
      </div>
    </div>
  );
}

export default function TicketDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [users, setUsers] = useState<DeskUser[]>([]);
  const [canned, setCanned] = useState<CannedResponse[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    kind: "info" | "success" | "error";
    message: string;
  } | null>(null);

  const [reply, setReply] = useState("");
  const [replyDirection, setReplyDirection] = useState<ReplyDirection>("Public");
  const [cannedId, setCannedId] = useState("");
  const [sending, setSending] = useState(false);

  const [tagsDraft, setTagsDraft] = useState("");
  const [savingTags, setSavingTags] = useState(false);

  // Log-time drawer state.
  const [logOpen, setLogOpen] = useState(false);
  const [logForm, setLogForm] = useState({
    minutes: 15,
    notes: "",
    billable: false,
  });
  const [savingTime, setSavingTime] = useState(false);

  const listRef = useRef<HTMLDivElement | null>(null);

  const [aiSuggestion, setAiSuggestion] = useState<{
    id: string;
    suggestedPriority: string | null;
    suggestedCategory: string | null;
    matchingArticleIds: string[];
    suggestedResponse: string | null;
    confidence: number;
    autoApplied: boolean;
  } | null>(null);

  const load = useCallback(async () => {
    try {
      const [t, s] = await Promise.all([
        api.get<TicketDetail>(`/desk/tickets/${id}`),
        api.get<typeof aiSuggestion>(`/desk/tickets/${id}/ai-suggestion`).catch(() => null),
      ]);
      setTicket(t);
      setAiSuggestion(s);
      setTagsDraft((t.tags ?? []).join(", "));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load ticket");
    }
  }, [id]);

  async function acceptSuggestion() {
    if (!aiSuggestion) return;
    try {
      await api.post(`/desk/tickets/${id}/ai-suggestion/accept`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  function fillReplyFromSuggestion() {
    if (aiSuggestion?.suggestedResponse) {
      setReply(aiSuggestion.suggestedResponse);
    }
  }

  useEffect(() => {
    load();
    // Poll every 8s so incoming replies (customer email-in / other agents)
    // and SLA changes show up without a manual refresh.
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    fetchDeskUsers().then(setUsers);
    api
      .get<CannedResponse[]>("/desk/canned-responses")
      .then(setCanned)
      .catch(() => setCanned([]));
  }, []);

  // Scroll the timeline to the bottom when new replies arrive.
  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [ticket?.replies.length]);

  // Time-tracked total across all entries.
  const totalMinutes = useMemo(
    () => (ticket?.timeEntries ?? []).reduce((sum, e) => sum + e.minutes, 0),
    [ticket?.timeEntries],
  );

  const assigneeUser = ticket?.assigneeUserId
    ? users.find((u) => u.id === ticket.assigneeUserId)
    : null;

  async function updateField(partial: Record<string, unknown>) {
    if (!ticket) return;
    try {
      await api.put(`/desk/tickets/${ticket.id}`, partial);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    }
  }

  async function changeStatus(next: TicketStatus) {
    if (!ticket || next === ticket.status) return;
    try {
      await api.post(`/desk/tickets/${ticket.id}/set-status`, { status: next });
      await load();
      setToast({ kind: "success", message: `Status set to ${next}.` });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to change status");
    }
  }

  async function changeAssignee(userId: string) {
    if (!ticket) return;
    try {
      await api.post(`/desk/tickets/${ticket.id}/assign`, {
        assigneeUserId: userId,
      });
      await load();
      setToast({ kind: "success", message: "Assignee updated." });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reassign");
    }
  }

  async function saveTags() {
    if (!ticket || savingTags) return;
    setSavingTags(true);
    try {
      const tags = tagsDraft
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      await api.put(`/desk/tickets/${ticket.id}`, { tags });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save tags");
    } finally {
      setSavingTags(false);
    }
  }

  async function deleteTicket() {
    if (!ticket) return;
    if (!confirm(`Delete ${ticket.name}? This cannot be undone.`)) return;
    try {
      await api.del(`/desk/tickets/${ticket.id}`);
      router.push("/crm/desk/inbox");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  async function sendReply(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!ticket || sending) return;
    const body = reply.trim();
    if (!body) return;
    setSending(true);
    try {
      await api.post(`/desk/tickets/${ticket.id}/reply`, {
        body,
        direction: replyDirection,
        cannedResponseId: cannedId || undefined,
      });
      setReply("");
      setCannedId("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send reply");
    } finally {
      setSending(false);
    }
  }

  function onReplyKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Cmd/Ctrl+Enter sends. Plain Enter inserts a newline (typical for
    // longer ticket replies vs quick chat).
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void sendReply();
    }
  }

  function onPickCanned(cid: string) {
    setCannedId(cid);
    if (!cid) return;
    const c = canned.find((x) => x.id === cid);
    if (c) setReply((prev) => (prev ? prev + "\n\n" + c.body : c.body));
  }

  async function logTime(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!ticket || savingTime) return;
    if (logForm.minutes <= 0) return;
    setSavingTime(true);
    try {
      await api.post(`/desk/tickets/${ticket.id}/log-time`, {
        minutes: Number(logForm.minutes),
        notes: logForm.notes.trim() || undefined,
        billable: logForm.billable,
      });
      setLogOpen(false);
      setLogForm({ minutes: 15, notes: "", billable: false });
      await load();
      setToast({ kind: "success", message: "Time logged." });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to log time");
    } finally {
      setSavingTime(false);
    }
  }

  if (!ticket) {
    return (
      <>
        <PageHeader
          breadcrumb={[
            { label: "CRM", href: "/crm" },
            { label: "Ticket Inbox", href: "/crm/desk/inbox" },
          ]}
          title="Loading…"
        />
      </>
    );
  }

  const anyBreach =
    ticket.slaFirstResponseBreached || ticket.slaResolutionBreached;

  return (
    <>
      <PageHeader
        title={ticket.subject}
        breadcrumb={[
          { label: "CRM", href: "/crm" },
          { label: "Ticket Inbox", href: "/crm/desk/inbox" },
          { label: ticket.name },
        ]}
        subtitle={
          <span className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-xs text-ink-muted">{ticket.name}</span>
            <TicketStatusBadge status={ticket.status} />
            <PriorityBadge priority={ticket.priority} />
            {anyBreach && <span className="badge-red">⚠ SLA breached</span>}
            <span className="text-xs text-ink-muted">
              · Opened {relativeTime(ticket.createdAt)}
            </span>
          </span>
        }
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => history.back()}
              type="button"
            >
              ← Back
            </Button>
            <Button variant="secondary" onClick={() => setLogOpen(true)}>
              Log time
            </Button>
            <Button variant="danger" onClick={deleteTicket}>
              Delete
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
          <Toast
            kind={toast.kind}
            message={toast.message}
            onDismiss={() => setToast(null)}
          />
        </div>
      )}

      {aiSuggestion && aiSuggestion.confidence > 0 && (
        <div className={`mb-4 rounded-lg border px-3 py-2 text-sm flex items-start gap-3 ${
          aiSuggestion.autoApplied
            ? "border-green-200 bg-green-50"
            : aiSuggestion.confidence >= 70
              ? "border-amber-200 bg-amber-50"
              : "border-brand-200 bg-brand-50"
        }`}>
          <span className="font-medium">
            AI · {aiSuggestion.confidence}% confidence
            {aiSuggestion.autoApplied && " · auto-applied"}
          </span>
          <span className="flex-1 text-ink-soft">
            Priority: <b>{aiSuggestion.suggestedPriority ?? "—"}</b>
            {" · "}
            Category: <b>{aiSuggestion.suggestedCategory ?? "—"}</b>
            {aiSuggestion.matchingArticleIds.length > 0 && (
              <>
                {" · "}
                {aiSuggestion.matchingArticleIds.length} matching KB article
                {aiSuggestion.matchingArticleIds.length === 1 ? "" : "s"}
              </>
            )}
          </span>
          {!aiSuggestion.autoApplied && (aiSuggestion.suggestedPriority || aiSuggestion.suggestedCategory) && (
            <button className="btn-brand btn-sm" onClick={acceptSuggestion}>Accept</button>
          )}
          {aiSuggestion.suggestedResponse && (
            <button className="btn-ghost btn-sm" onClick={fillReplyFromSuggestion} title="Populate reply box with the suggested response">
              Draft reply
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* ── Left: conversation ─────────────────────────────────────── */}
        <div className="lg:col-span-2 flex flex-col">
          <Card className="flex-1 flex flex-col overflow-hidden">
            <CardHeader
              title="Conversation"
              subtitle={`${ticket.replies.length} repl${ticket.replies.length === 1 ? "y" : "ies"}`}
            />
            <div
              ref={listRef}
              className="flex-1 overflow-y-auto bg-surface-sunken px-4 py-3 space-y-2"
              style={{ minHeight: "360px", maxHeight: "55vh" }}
            >
              {/* Original description as the first "bubble" for context. */}
              {ticket.description && (
                <div className="rounded-lg border border-ink-muted/10 bg-white p-3 border-s-4 border-s-brand-400">
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className="h-6 w-6 rounded-full bg-brand-100 text-brand-700 grid place-items-center text-[10px] font-bold">
                      {(ticket.requesterName || "?").trim().charAt(0).toUpperCase()}
                    </div>
                    <span className="text-sm font-medium text-ink">
                      {ticket.requesterName || "Requester"}
                    </span>
                    <span className="badge-gray">Original</span>
                    <span className="text-[11px] text-ink-muted ms-auto">
                      {relativeTime(ticket.createdAt)}
                    </span>
                  </div>
                  <div className="text-sm text-ink whitespace-pre-wrap break-words">
                    {ticket.description}
                  </div>
                </div>
              )}
              {ticket.replies.length === 0 && !ticket.description && (
                <div className="h-full grid place-items-center text-sm text-ink-muted">
                  No replies yet.
                </div>
              )}
              {ticket.replies.map((r) => (
                <ReplyCard key={r.id} reply={r} />
              ))}
            </div>
            {/* Composer */}
            <form
              onSubmit={sendReply}
              className="border-t border-ink-muted/10 p-3 space-y-2"
            >
              <div className="flex items-center gap-2 flex-wrap">
                <div className="inline-flex bg-surface-sunken rounded-lg p-0.5 border border-ink-muted/10">
                  {(["Public", "Private"] as ReplyDirection[]).map((d) => {
                    const active = d === replyDirection;
                    return (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setReplyDirection(d)}
                        className={`px-3 py-1 text-xs font-medium rounded-md transition ${
                          active
                            ? d === "Public"
                              ? "bg-white text-brand-700 shadow-brand-sm"
                              : "bg-amber-100 text-amber-800"
                            : "text-ink-muted hover:text-ink-soft"
                        }`}
                      >
                        {d === "Public" ? "Public reply" : "Private note"}
                      </button>
                    );
                  })}
                </div>
                <select
                  className="input input-sm max-w-[220px]"
                  value={cannedId}
                  onChange={(e) => onPickCanned(e.target.value)}
                >
                  <option value="">Insert canned response…</option>
                  {canned.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.category ? ` · ${c.category}` : ""}
                    </option>
                  ))}
                </select>
                <div className="flex-1" />
                <span className="text-[11px] text-ink-muted hidden md:inline">
                  Cmd/Ctrl+Enter to send
                </span>
              </div>
              <textarea
                className={`input resize-none ${
                  replyDirection === "Private" ? "bg-amber-50/40" : ""
                }`}
                rows={4}
                placeholder={
                  replyDirection === "Public"
                    ? "Reply to the requester…"
                    : "Add an internal note visible to agents only…"
                }
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                onKeyDown={onReplyKeyDown}
                disabled={sending}
              />
              <div className="flex justify-end">
                <Button
                  type="submit"
                  variant="brand"
                  icon={Icon.send}
                  disabled={sending || reply.trim().length === 0}
                >
                  {sending
                    ? "Sending…"
                    : replyDirection === "Public"
                      ? "Send reply"
                      : "Add note"}
                </Button>
              </div>
            </form>
          </Card>
        </div>

        {/* ── Right: properties panel ────────────────────────────────── */}
        <div className="space-y-4">
          <Card className="p-4 space-y-3">
            <SectionHeader title="Properties" />
            <FormField label="Status">
              <select
                className="input"
                value={ticket.status}
                onChange={(e) => changeStatus(e.target.value as TicketStatus)}
              >
                <option value="New">New</option>
                <option value="Open">Open</option>
                <option value="InProgress">In Progress</option>
                <option value="OnHold">On Hold</option>
                <option value="Resolved">Resolved</option>
                <option value="Closed">Closed</option>
              </select>
            </FormField>
            <FormField label="Priority">
              <select
                className="input"
                value={ticket.priority}
                onChange={(e) =>
                  updateField({ priority: e.target.value as TicketPriority })
                }
              >
                <option value="Urgent">Urgent</option>
                <option value="High">High</option>
                <option value="Medium">Medium</option>
                <option value="Low">Low</option>
              </select>
            </FormField>
            <FormField label="Type">
              <select
                className="input"
                value={ticket.type}
                onChange={(e) =>
                  updateField({ type: e.target.value as TicketType })
                }
              >
                <option value="Question">Question</option>
                <option value="Incident">Incident</option>
                <option value="Problem">Problem</option>
                <option value="FeatureRequest">Feature Request</option>
                <option value="Task">Task</option>
              </select>
            </FormField>
            <FormField label="Assignee">
              <select
                className="input"
                value={ticket.assigneeUserId ?? ""}
                onChange={(e) => changeAssignee(e.target.value)}
              >
                <option value="">— Unassigned —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName || u.email}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Tags" hint="Comma-separated. Blur to save.">
              <input
                className="input"
                value={tagsDraft}
                onChange={(e) => setTagsDraft(e.target.value)}
                onBlur={saveTags}
                disabled={savingTags}
                placeholder="billing, urgent"
              />
            </FormField>
          </Card>

          <Card className="p-4 space-y-3">
            <SectionHeader title="Requester" />
            <Field label="Name" value={ticket.requesterName ?? "—"} />
            <Field
              label="Email"
              value={
                ticket.requesterEmail ? (
                  <a
                    className="text-brand-600 hover:underline break-all"
                    href={`mailto:${ticket.requesterEmail}`}
                  >
                    {ticket.requesterEmail}
                  </a>
                ) : (
                  "—"
                )
              }
            />
            <Field label="Phone" value={ticket.requesterPhone ?? "—"} />
            <Field label="Channel" value={ticket.channel} />
            {ticket.linkedCustomerId && (
              <Field
                label="Linked customer"
                value={
                  <a
                    className="text-brand-600 hover:underline"
                    href={`/accounting/customers/${ticket.linkedCustomerId}`}
                  >
                    View customer
                  </a>
                }
              />
            )}
            {ticket.linkedLeadId && (
              <Field
                label="Linked lead"
                value={
                  <a
                    className="text-brand-600 hover:underline"
                    href={`/crm/leads/${ticket.linkedLeadId}`}
                  >
                    View lead
                  </a>
                }
              />
            )}
          </Card>

          <Card className="p-4 space-y-3">
            <SectionHeader title="SLA" />
            <Field
              label="Policy"
              value={ticket.slaPolicy ? ticket.slaPolicy.name : "—"}
            />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
                  First response
                </div>
                <div className="mt-1">
                  <SlaIndicator
                    dueAt={ticket.firstResponseDueAt}
                    breached={ticket.slaFirstResponseBreached}
                    metAt={ticket.firstResponseAt}
                  />
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
                  Resolution
                </div>
                <div className="mt-1">
                  <SlaIndicator
                    dueAt={ticket.resolutionDueAt}
                    breached={ticket.slaResolutionBreached}
                    metAt={ticket.resolvedAt}
                  />
                </div>
              </div>
            </div>
          </Card>

          <Card className="p-4 space-y-3">
            <SectionHeader
              title="Time tracked"
              actions={
                <button
                  onClick={() => setLogOpen(true)}
                  className="text-xs text-brand-600 hover:underline"
                >
                  + Log
                </button>
              }
            />
            <div className="flex items-baseline gap-2">
              <span className="stat-value">{Math.floor(totalMinutes / 60)}h</span>
              <span className="text-sm text-ink-muted">
                {totalMinutes % 60}m across {ticket.timeEntries.length} entr
                {ticket.timeEntries.length === 1 ? "y" : "ies"}
              </span>
            </div>
            {ticket.timeEntries.length > 0 && (
              <ul className="divide-y divide-ink-muted/10 -mx-4">
                {ticket.timeEntries.slice(0, 5).map((e, i) => (
                  <li key={i} className="px-4 py-2 flex items-center gap-2">
                    <span className="text-sm text-ink font-medium tabular-nums">
                      {e.minutes}m
                    </span>
                    {e.billable && <span className="badge-green">Billable</span>}
                    <span className="text-xs text-ink-muted truncate flex-1">
                      {e.notes || "—"}
                    </span>
                    <span className="text-[11px] text-ink-muted">
                      {dateShort(e.startedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {ticket.csatRating && (
            <Card className="p-4 space-y-2">
              <SectionHeader title="CSAT" />
              <div className="flex items-center gap-2">
                <span className="stat-value">{ticket.csatRating.score}/5</span>
                <span className="text-xs text-ink-muted">
                  · {relativeTime(ticket.csatRating.ratedAt)}
                </span>
              </div>
              {ticket.csatRating.comment && (
                <div className="text-sm text-ink-soft italic">
                  “{ticket.csatRating.comment}”
                </div>
              )}
            </Card>
          )}

          {assigneeUser && (
            <div className="text-[11px] text-ink-muted text-center">
              Currently assigned to {assigneeUser.fullName || assigneeUser.email}
            </div>
          )}
        </div>
      </div>

      {/* Log-time drawer */}
      <Drawer
        open={logOpen}
        onClose={() => setLogOpen(false)}
        title="Log time"
        width="w-[400px]"
        footer={
          <>
            <Button variant="secondary" onClick={() => setLogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="brand"
              onClick={() => logTime()}
              disabled={savingTime || logForm.minutes <= 0}
            >
              {savingTime ? "Saving…" : "Log time"}
            </Button>
          </>
        }
      >
        <form onSubmit={logTime} className="space-y-4">
          <FormField label="Minutes" required>
            <input
              type="number"
              min={1}
              required
              className="input"
              value={logForm.minutes}
              onChange={(e) =>
                setLogForm({ ...logForm, minutes: Number(e.target.value) })
              }
            />
          </FormField>
          <FormField label="Notes">
            <textarea
              className="input resize-none"
              rows={3}
              value={logForm.notes}
              onChange={(e) => setLogForm({ ...logForm, notes: e.target.value })}
              placeholder="Optional details about the work"
            />
          </FormField>
          <label className="flex items-center gap-2 text-sm text-ink-soft cursor-pointer">
            <input
              type="checkbox"
              checked={logForm.billable}
              onChange={(e) =>
                setLogForm({ ...logForm, billable: e.target.checked })
              }
            />
            Billable
          </label>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>

      <div className="rounded-xl border border-ink/10 bg-canvas p-4 mt-6">
        <h3 className="text-sm font-semibold text-ink mb-3">Activity</h3>
        <DocActivityPanel doctype="Ticket" docId={params.id} />
      </div>
    </>
  );
}
