"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "../../../lib/api";
import {
  Button,
  Card,
  PageHeader,
  Skeleton,
  Toast,
  relativeTime,
} from "../../../components/ui";

interface WhatsappMessage {
  id: string;
  direction: string; // outbound | inbound
  toMobile: string;
  fromMobile: string | null;
  body: string;
  mediaUrl: string | null;
  status: string;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  createdAt: string;
}

interface Conversation {
  peer: string;
  messages: WhatsappMessage[];
  lastMessageAt: string;
  lastMessagePreview: string;
  lastInboundAt: string | null;
  unread: number;
}

// WABA 24-hour customer-care window: after the last inbound message we can
// reply with freeform text; outside the window a Meta-approved template is
// required. We compute this so the composer disables when the window closes.
function within24h(iso: string | null): boolean {
  if (!iso) return false;
  const then = new Date(iso).getTime();
  return Date.now() - then <= 24 * 60 * 60 * 1000;
}

function peerFor(m: WhatsappMessage): string {
  return m.direction === "inbound"
    ? m.fromMobile ?? m.toMobile
    : m.toMobile;
}

export default function WhatsappInboxPage() {
  const [rows, setRows] = useState<WhatsappMessage[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const data = await api.get<WhatsappMessage[]>("/whatsapp/messages");
      setRows(data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load";
      if (/404|500|Request failed/.test(msg)) {
        setNotice("WhatsApp inbox is not wired yet — no conversations to show.");
        setRows([]);
      } else {
        setError(msg);
      }
    }
  }
  useEffect(() => {
    load();
  }, []);

  const conversations = useMemo<Conversation[]>(() => {
    if (!rows) return [];
    const buckets = new Map<string, WhatsappMessage[]>();
    for (const m of rows) {
      const key = peerFor(m);
      if (!key) continue;
      const arr = buckets.get(key) ?? [];
      arr.push(m);
      buckets.set(key, arr);
    }
    const out: Conversation[] = [];
    for (const [peer, msgs] of buckets) {
      msgs.sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
      const last = msgs[msgs.length - 1];
      const lastInbound = [...msgs]
        .reverse()
        .find((m) => m.direction === "inbound");
      out.push({
        peer,
        messages: msgs,
        lastMessageAt: last.createdAt,
        lastMessagePreview: last.body || (last.mediaUrl ? "[media]" : ""),
        lastInboundAt: lastInbound?.createdAt ?? null,
        // Naive "unread" heuristic: inbound messages after the last outbound
        // one that isn't yet Read. A real read-receipt flow would use a
        // per-conversation last-viewed timestamp; deferred for backend.
        unread: (() => {
          const lastOutIdx = [...msgs]
            .map((m, i) => (m.direction === "outbound" ? i : -1))
            .filter((i) => i >= 0)
            .pop();
          const startIdx = lastOutIdx == null ? 0 : lastOutIdx + 1;
          return msgs.slice(startIdx).filter((m) => m.direction === "inbound")
            .length;
        })(),
      });
    }
    out.sort(
      (a, b) =>
        new Date(b.lastMessageAt).getTime() -
        new Date(a.lastMessageAt).getTime(),
    );
    return out;
  }, [rows]);

  const activeConvo =
    conversations.find((c) => c.peer === selected) ?? conversations[0] ?? null;
  const canReplyFreeform = within24h(activeConvo?.lastInboundAt ?? null);

  async function sendText(e: React.FormEvent) {
    e.preventDefault();
    if (!activeConvo || !draft.trim()) return;
    if (!canReplyFreeform) {
      setError(
        "24-hour reply window is closed — send a Meta-approved template instead.",
      );
      return;
    }
    setSending(true);
    setError(null);
    try {
      await api.post("/whatsapp/send/text", {
        toMobile: activeConvo.peer,
        body: draft.trim(),
      });
      setDraft("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Send failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <PageHeader
        breadcrumb={[
          { label: "WhatsApp", href: "/crm/whatsapp" },
          { label: "Inbox" },
        ]}
        title="WhatsApp Inbox"
        subtitle={
          conversations.length > 0
            ? `${conversations.length} conversation${conversations.length === 1 ? "" : "s"}`
            : undefined
        }
        actions={
          <>
            <Button
              variant="secondary"
              type="button"
              onClick={() => history.back()}
            >
              ← Back
            </Button>
            <a href="/crm/whatsapp/new">
              <Button variant="brand" type="button">
                + New message
              </Button>
            </a>
          </>
        }
      />

      {notice && (
        <div className="mb-4">
          <Toast
            kind="info"
            message={notice}
            onDismiss={() => setNotice(null)}
          />
        </div>
      )}
      {error && (
        <div className="mb-4">
          <Toast
            kind="error"
            message={error}
            onDismiss={() => setError(null)}
          />
        </div>
      )}

      {!rows ? (
        <div className="grid grid-cols-3 gap-4">
          <Skeleton className="h-[540px] col-span-1" rounded="rounded-lg" />
          <Skeleton className="h-[540px] col-span-2" rounded="rounded-lg" />
        </div>
      ) : conversations.length === 0 ? (
        <Card className="p-12 text-center text-ink-muted text-sm">
          No conversations yet. Once contacts reply to your outbound messages
          they will appear here.
        </Card>
      ) : (
        <div className="grid grid-cols-3 gap-4 min-h-[540px]">
          {/* ── Contact list (left pane) ─────────────────────────────── */}
          <Card className="p-0 col-span-1 overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b border-ink-muted/10 text-xs uppercase tracking-wider text-ink-muted font-semibold">
              Conversations
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-ink-muted/5">
              {conversations.map((c) => {
                const isActive = (activeConvo?.peer ?? "") === c.peer;
                return (
                  <button
                    key={c.peer}
                    onClick={() => setSelected(c.peer)}
                    className={`w-full text-start px-4 py-3 hover:bg-brand-50/60 transition ${
                      isActive ? "bg-brand-50" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-sm text-ink truncate">
                        {c.peer}
                      </span>
                      {c.unread > 0 && (
                        <span className="ms-2 badge-brand tabular-nums">
                          {c.unread}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between mt-0.5">
                      <span className="text-xs text-ink-muted truncate max-w-[220px]">
                        {c.lastMessagePreview || "—"}
                      </span>
                      <span className="text-[10px] text-ink-muted tabular-nums shrink-0">
                        {relativeTime(c.lastMessageAt)}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </Card>

          {/* ── Chat pane (right) ────────────────────────────────────── */}
          <Card className="p-0 col-span-2 flex flex-col">
            {activeConvo ? (
              <>
                <div className="px-4 py-3 border-b border-ink-muted/10 flex items-center justify-between">
                  <div>
                    <div className="font-mono text-sm text-ink">
                      {activeConvo.peer}
                    </div>
                    <div className="text-[11px] text-ink-muted">
                      {canReplyFreeform ? (
                        <span className="text-green-700">
                          Reply window open — freeform allowed
                        </span>
                      ) : (
                        <span className="text-amber-700">
                          Reply window closed — template required
                        </span>
                      )}
                    </div>
                  </div>
                  <a
                    href={`/crm/whatsapp/new?to=${encodeURIComponent(activeConvo.peer)}`}
                  >
                    <Button variant="secondary" type="button">
                      Send template
                    </Button>
                  </a>
                </div>

                <div className="flex-1 overflow-y-auto p-5 space-y-3 bg-surface-sunken">
                  {activeConvo.messages.map((m) => {
                    const out = m.direction === "outbound";
                    return (
                      <div
                        key={m.id}
                        className={`flex ${out ? "justify-end" : "justify-start"}`}
                      >
                        <div
                          className={`max-w-[70%] rounded-2xl px-4 py-2 text-sm ${
                            out
                              ? "bg-brand-600 text-white rounded-br-sm"
                              : "bg-white text-ink border border-ink-muted/10 rounded-bl-sm"
                          }`}
                        >
                          <div className="whitespace-pre-wrap">
                            {m.body || (m.mediaUrl ? "[media]" : "—")}
                          </div>
                          <div
                            className={`text-[10px] mt-1 flex items-center gap-1 ${
                              out ? "text-white/70" : "text-ink-muted"
                            }`}
                          >
                            <span>{relativeTime(m.createdAt)}</span>
                            {out && (
                              <span>
                                ·{" "}
                                {m.status === "Read"
                                  ? "read"
                                  : m.status === "Delivered"
                                    ? "delivered"
                                    : m.status === "Sent"
                                      ? "sent"
                                      : m.status.toLowerCase()}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <form
                  onSubmit={sendText}
                  className="border-t border-ink-muted/10 p-3 flex items-end gap-2 bg-surface-raised"
                >
                  <textarea
                    className="input flex-1"
                    rows={2}
                    placeholder={
                      canReplyFreeform
                        ? "Type a reply…"
                        : "24-hour reply window is closed. Send a template instead."
                    }
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    disabled={!canReplyFreeform || sending}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void sendText(e as unknown as React.FormEvent);
                      }
                    }}
                  />
                  <Button
                    variant="brand"
                    type="submit"
                    disabled={!canReplyFreeform || sending || !draft.trim()}
                  >
                    {sending ? "Sending…" : "Send"}
                  </Button>
                </form>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-ink-muted text-sm">
                Select a conversation to view messages.
              </div>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
