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
  StatusBadge,
  Toast,
  dateShort,
  relativeTime,
} from "../../../../components/ui";
import { Icon } from "../../../../components/app-shell";

// SalesIQ conversation view — a live two-column layout: messages on the
// left, visitor detail on the right. Messages poll every 3s using
// ?after=<lastId> so incremental deltas are cheap; new messages append
// locally after a successful reply so we don't wait for the poll.

interface PageView {
  url: string;
  title: string | null;
  createdAt: string;
}

interface VisitorFull {
  id: string;
  displayName: string | null;
  email: string | null;
  phone: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  country: string | null;
  city: string | null;
  currentUrl: string | null;
  pageCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  status: string;
  linkedLeadId: string | null;
  pageViews?: PageView[];
}

interface ChatSession {
  id: string;
  visitorId: string;
  operatorUserId: string | null;
  status: "Open" | "Assigned" | "Closed" | "Bot";
  subject: string | null;
  startedAt: string;
  closedAt: string | null;
  unreadForOperator: number;
  visitor: VisitorFull;
}

type SenderKind = "Visitor" | "Operator" | "Bot" | "System";
interface ChatMessage {
  id: string;
  sender: SenderKind;
  senderName: string | null;
  body: string;
  createdAt: string;
}

interface LeadForm {
  leadName: string;
  companyName: string;
  email: string;
  mobile: string;
}

// Avatar circle from the first letter of a display name.
function Avatar({ name }: { name: string | null | undefined }) {
  const letter = (name || "?").trim().charAt(0).toUpperCase() || "?";
  return (
    <span className="h-10 w-10 rounded-full bg-brand-100 text-brand-700 grid place-items-center text-sm font-bold shrink-0">
      {letter}
    </span>
  );
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  if (msg.sender === "System") {
    return (
      <div className="flex justify-center my-2">
        <span className="text-[11px] text-ink-muted bg-surface-sunken rounded-full px-3 py-1">
          {msg.body}
        </span>
      </div>
    );
  }
  const mine = msg.sender === "Operator";
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"} my-1.5`}>
      <div
        className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm shadow-brand-sm ${
          mine
            ? "bg-brand-600 text-white rounded-br-md"
            : msg.sender === "Bot"
              ? "bg-brand-50 text-brand-800 border border-brand-100 rounded-bl-md"
              : "bg-white text-ink border border-ink-muted/10 rounded-bl-md"
        }`}
      >
        {!mine && msg.senderName && (
          <div
            className={`text-[10px] font-semibold uppercase tracking-wide mb-0.5 ${
              msg.sender === "Bot" ? "text-brand-500" : "text-ink-muted"
            }`}
          >
            {msg.senderName}
          </div>
        )}
        <div className="whitespace-pre-wrap break-words">{msg.body}</div>
        <div
          className={`text-[10px] mt-1 ${mine ? "text-white/70" : "text-ink-muted"}`}
        >
          {relativeTime(msg.createdAt)}
        </div>
      </div>
    </div>
  );
}

export default function ChatConversationPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [session, setSession] = useState<ChatSession | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    kind: "info" | "success" | "error";
    message: string;
  } | null>(null);

  const [showLead, setShowLead] = useState(false);
  const [leadForm, setLeadForm] = useState<LeadForm>({
    leadName: "",
    companyName: "",
    email: "",
    mobile: "",
  });
  const [creatingLead, setCreatingLead] = useState(false);

  const listRef = useRef<HTMLDivElement | null>(null);
  const lastMsgIdRef = useRef<string | null>(null);

  // Auto-scroll on message list growth.
  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages.length]);

  const loadSession = useCallback(async () => {
    try {
      const s = await api.get<ChatSession>(`/siq/chat-sessions/${id}`);
      setSession(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load chat");
    }
  }, [id]);

  // Full message load — used once on mount, then we switch to delta polls.
  const loadMessagesInitial = useCallback(async () => {
    try {
      const msgs = await api.get<ChatMessage[]>(
        `/siq/chat-sessions/${id}/messages`,
      );
      setMessages(msgs);
      lastMsgIdRef.current = msgs.length ? msgs[msgs.length - 1].id : null;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load messages");
    }
  }, [id]);

  // Delta poll — only pull messages after the last-seen id.
  const pollMessages = useCallback(async () => {
    try {
      const after = lastMsgIdRef.current;
      const q = after ? `?after=${encodeURIComponent(after)}` : "";
      const next = await api.get<ChatMessage[]>(
        `/siq/chat-sessions/${id}/messages${q}`,
      );
      if (next.length === 0) return;
      setMessages((prev) => {
        // De-dupe in case the reply optimistic append raced with a poll.
        const seen = new Set(prev.map((m) => m.id));
        const merged = [...prev];
        for (const m of next) if (!seen.has(m.id)) merged.push(m);
        return merged;
      });
      lastMsgIdRef.current = next[next.length - 1].id;
    } catch {
      // Poll errors are non-fatal; the next tick will retry.
    }
  }, [id]);

  useEffect(() => {
    loadSession();
    loadMessagesInitial();
  }, [loadSession, loadMessagesInitial]);

  // 3s message poll. Also refresh session periodically so the status badge
  // updates if the visitor closes/returns.
  useEffect(() => {
    const t = setInterval(pollMessages, 3000);
    const s = setInterval(loadSession, 15000);
    return () => {
      clearInterval(t);
      clearInterval(s);
    };
  }, [pollMessages, loadSession]);

  const isClosed = session?.status === "Closed";

  async function sendReply(e?: React.FormEvent) {
    if (e) e.preventDefault();
    const body = reply.trim();
    if (!body || sending || isClosed) return;
    setSending(true);
    try {
      const created = await api.post<ChatMessage>(
        `/siq/chat-sessions/${id}/reply`,
        { body },
      );
      setMessages((prev) => {
        if (prev.some((m) => m.id === created.id)) return prev;
        return [...prev, created];
      });
      lastMsgIdRef.current = created.id;
      setReply("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send reply");
    } finally {
      setSending(false);
    }
  }

  function onReplyKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter inserts a newline (standard chat UX).
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendReply();
    }
  }

  async function closeChat() {
    if (!confirm("Close this chat? The visitor will see it as ended.")) return;
    try {
      await api.post(`/siq/chat-sessions/${id}/close`, {});
      await loadSession();
      setToast({ kind: "success", message: "Chat closed." });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to close chat");
    }
  }

  function openLeadDrawer() {
    if (!session) return;
    const v = session.visitor;
    setLeadForm({
      leadName: v.displayName ?? "",
      companyName: "",
      email: v.email ?? "",
      mobile: v.phone ?? "",
    });
    setShowLead(true);
  }

  async function createLead(e: React.FormEvent) {
    e.preventDefault();
    if (creatingLead) return;
    setCreatingLead(true);
    try {
      const lead = await api.post<{ id: string }>(
        `/siq/chat-sessions/${id}/create-lead`,
        {
          leadName: leadForm.leadName,
          companyName: leadForm.companyName || undefined,
          email: leadForm.email || undefined,
          mobile: leadForm.mobile || undefined,
        },
      );
      setShowLead(false);
      router.push(`/crm/leads/${lead.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create lead");
    } finally {
      setCreatingLead(false);
    }
  }

  const visitor = session?.visitor;

  const geo = useMemo(() => {
    if (!visitor) return "—";
    const parts = [visitor.country, visitor.city].filter(Boolean);
    return parts.length ? parts.join(" · ") : "—";
  }, [visitor]);

  if (!session) {
    return (
      <>
        <PageHeader
          breadcrumb={[
            { label: "CRM", href: "/crm" },
            { label: "Chat Inbox", href: "/crm/salesiq/inbox" },
          ]}
          title="Loading…"
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={visitor?.displayName || "Anonymous visitor"}
        breadcrumb={[
          { label: "CRM", href: "/crm" },
          { label: "Chat Inbox", href: "/crm/salesiq/inbox" },
          { label: visitor?.displayName || "Chat" },
        ]}
        subtitle={
          <span className="flex items-center gap-2">
            <StatusBadge status={session.status} />
            {session.subject && (
              <span className="text-xs text-ink-muted">· {session.subject}</span>
            )}
            <span className="text-xs text-ink-muted">
              · Started {relativeTime(session.startedAt)}
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
            <Button variant="secondary" onClick={openLeadDrawer}>
              Create lead
            </Button>
            <Button
              variant="danger"
              onClick={closeChat}
              disabled={isClosed}
            >
              {isClosed ? "Chat closed" : "Close chat"}
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* ── Messages column (2/3) ─────────────────────────────────── */}
        <div className="lg:col-span-2 flex flex-col">
          <Card className="flex-1 flex flex-col overflow-hidden">
            <CardHeader
              title="Conversation"
              subtitle={`${messages.length} message${messages.length === 1 ? "" : "s"}`}
            />
            <div
              ref={listRef}
              className="flex-1 overflow-y-auto bg-surface-sunken px-4 py-3"
              style={{ minHeight: "420px", maxHeight: "60vh" }}
            >
              {messages.length === 0 ? (
                <div className="h-full grid place-items-center text-sm text-ink-muted">
                  No messages yet.
                </div>
              ) : (
                messages.map((m) => <MessageBubble key={m.id} msg={m} />)
              )}
            </div>
            {isClosed ? (
              <div className="border-t border-ink-muted/10 px-4 py-3 text-sm text-ink-muted bg-surface-sunken text-center">
                This chat is closed.
                {session.closedAt && (
                  <span className="ms-1 text-xs">
                    · {relativeTime(session.closedAt)}
                  </span>
                )}
              </div>
            ) : (
              <form
                onSubmit={sendReply}
                className="border-t border-ink-muted/10 p-3 flex items-end gap-2"
              >
                <textarea
                  className="input flex-1 resize-none"
                  rows={2}
                  placeholder="Type a reply — Enter to send, Shift+Enter for newline"
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  onKeyDown={onReplyKeyDown}
                  disabled={sending}
                />
                <Button
                  type="submit"
                  variant="brand"
                  icon={Icon.send}
                  disabled={sending || reply.trim().length === 0}
                >
                  Send
                </Button>
              </form>
            )}
          </Card>
        </div>

        {/* ── Visitor sidebar (1/3) ─────────────────────────────────── */}
        <div className="space-y-4">
          <Card>
            <div className="p-4 flex items-center gap-3">
              <Avatar name={visitor?.displayName} />
              <div className="min-w-0">
                <div className="font-semibold text-ink truncate">
                  {visitor?.displayName || "Anonymous"}
                </div>
                <div className="text-xs text-ink-muted truncate">
                  {visitor?.email || "No email"}
                </div>
              </div>
            </div>
            <div className="border-t border-ink-muted/10 p-4 space-y-3">
              {visitor?.phone && <Field label="Phone" value={visitor.phone} />}
              <Field label="IP address" value={visitor?.ipAddress ?? "—"} />
              <Field label="Location" value={geo} />
              <Field
                label="Current page"
                value={
                  visitor?.currentUrl ? (
                    <a
                      href={visitor.currentUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-brand-600 hover:underline break-all"
                    >
                      {visitor.currentUrl}
                    </a>
                  ) : (
                    "—"
                  )
                }
              />
              <Field
                label="Pages viewed"
                value={visitor?.pageCount?.toLocaleString() ?? "0"}
              />
              <Field
                label="First seen"
                value={dateShort(visitor?.firstSeenAt)}
              />
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Page journey"
              subtitle={`${visitor?.pageViews?.length ?? 0} page view${
                (visitor?.pageViews?.length ?? 0) === 1 ? "" : "s"
              }`}
            />
            <div
              className="overflow-y-auto"
              style={{ maxHeight: "360px" }}
            >
              {!visitor?.pageViews || visitor.pageViews.length === 0 ? (
                <div className="p-4 text-sm text-ink-muted text-center">
                  No page views tracked yet.
                </div>
              ) : (
                <ul className="divide-y divide-ink-muted/10">
                  {visitor.pageViews.map((p, i) => (
                    <li key={i} className="p-3">
                      <div className="text-sm text-ink truncate">
                        {p.title || p.url}
                      </div>
                      <div className="text-xs text-ink-muted truncate">
                        {p.url}
                      </div>
                      <div className="text-[10px] text-ink-muted mt-1">
                        {relativeTime(p.createdAt)}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* ── Create-lead drawer ────────────────────────────────────── */}
      <Drawer
        open={showLead}
        onClose={() => setShowLead(false)}
        title="Create lead from visitor"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowLead(false)}>
              Cancel
            </Button>
            <Button
              variant="brand"
              onClick={(e) => createLead(e as unknown as React.FormEvent)}
              disabled={creatingLead || !leadForm.leadName.trim()}
            >
              {creatingLead ? "Creating…" : "Create lead"}
            </Button>
          </>
        }
      >
        <form onSubmit={createLead} className="space-y-4">
          <FormField label="Lead name" required>
            <input
              required
              className="input"
              value={leadForm.leadName}
              onChange={(e) =>
                setLeadForm({ ...leadForm, leadName: e.target.value })
              }
            />
          </FormField>
          <FormField label="Company">
            <input
              className="input"
              value={leadForm.companyName}
              onChange={(e) =>
                setLeadForm({ ...leadForm, companyName: e.target.value })
              }
            />
          </FormField>
          <FormField label="Email">
            <input
              type="email"
              className="input"
              value={leadForm.email}
              onChange={(e) =>
                setLeadForm({ ...leadForm, email: e.target.value })
              }
            />
          </FormField>
          <FormField label="Mobile">
            <input
              className="input"
              value={leadForm.mobile}
              onChange={(e) =>
                setLeadForm({ ...leadForm, mobile: e.target.value })
              }
            />
          </FormField>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>

      <div className="rounded-xl border border-ink/10 bg-canvas p-4 mt-6">
        <h3 className="text-sm font-semibold text-ink mb-3">Activity</h3>
        <DocActivityPanel doctype="Chat" docId={params.id} />
      </div>
    </>
  );
}
