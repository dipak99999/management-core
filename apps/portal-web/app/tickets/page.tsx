"use client";

import { useEffect, useMemo, useState } from "react";
import { useListPageCommands, SavedViewsControls } from "@lumaara/web-ui";
import { accApi } from "../../lib/api";
import {
  Button,
  Card,
  DataTable,
  Drawer,
  FilterBar,
  FormField,
  PageHeader,
  Segmented,
  Skeleton,
  StatusBadge,
  Toast,
  dateShort,
  relativeTime,
  type Column,
} from "../../components/ui";

interface Ticket {
  id: string;
  name: string;
  subject: string;
  status: string;
  priority: string;
  createdAt: string;
  updatedAt: string;
  _count: { replies: number };
}

interface Reply {
  id: string;
  body: string;
  authorType: string;
  authorId: string;
  createdAt: string;
}
interface TicketDetail extends Ticket {
  replies: Reply[];
}

type Tab = "all" | "open" | "closed";

const PRIORITY_TONE: Record<string, string> = {
  Low: "text-ink-muted",
  Normal: "text-ink-soft",
  High: "text-amber-700 font-medium",
  Urgent: "text-red-700 font-semibold",
};

export default function TicketsPage() {
  const [rows, setRows] = useState<Ticket[] | null>(null);
  const [open, setOpen] = useState<TicketDetail | null>(null);
  const [form, setForm] = useState({
    subject: "",
    body: "",
    priority: "Normal" as "Low" | "Normal" | "High" | "Urgent",
  });
  const [showForm, setShowForm] = useState(false);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<Tab>("all");

  async function load() {
    try {
      setRows(await accApi.get<Ticket[]>("/portal/tickets"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => {
    load();
  }, []);

  useListPageCommands({
    singular: "Ticket",
    plural: "Tickets",
    refresh: load,
  });
  async function openTicket(id: string) {
    try {
      setOpen(await accApi.get<TicketDetail>(`/portal/tickets/${id}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await accApi.post("/portal/tickets", form);
      setShowForm(false);
      setForm({ subject: "", body: "", priority: "Normal" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function sendReply() {
    if (!open || !reply.trim()) return;
    setBusy(true);
    try {
      await accApi.post(`/portal/tickets/${open.id}/reply`, { body: reply });
      setReply("");
      await openTicket(open.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const counts = useMemo(() => {
    const list = rows ?? [];
    return {
      all: list.length,
      open: list.filter((t) => t.status !== "Closed").length,
      closed: list.filter((t) => t.status === "Closed").length,
    };
  }, [rows]);

  const filtered = useMemo(() => {
    const list = rows ?? [];
    const q = search.trim().toLowerCase();
    return list.filter((t) => {
      if (tab === "open" && t.status === "Closed") return false;
      if (tab === "closed" && t.status !== "Closed") return false;
      if (
        q &&
        !t.subject.toLowerCase().includes(q) &&
        !t.name.toLowerCase().includes(q)
      )
        return false;
      return true;
    });
  }, [rows, tab, search]);

  const columns: Column<Ticket>[] = [
    {
      header: "Ticket",
      cell: (t) => <span className="font-mono text-sm text-ink">{t.name}</span>,
    },
    {
      header: "Subject",
      cell: (t) => <span className="text-ink">{t.subject}</span>,
    },
    {
      header: "Priority",
      cell: (t) => (
        <span className={PRIORITY_TONE[t.priority] ?? "text-ink-soft"}>
          {t.priority}
        </span>
      ),
    },
    {
      header: "Replies",
      align: "right",
      cell: (t) => (
        <span className="tabular-nums">{t._count.replies}</span>
      ),
    },
    {
      header: "Last update",
      cell: (t) => (
        <span className="text-ink-soft">{relativeTime(t.updatedAt)}</span>
      ),
    },
    { header: "Status", cell: (t) => <StatusBadge status={t.status} /> },
  ];

  if (error && !rows) {
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[
            { label: "Home", href: "/" },
            { label: "Support tickets" },
          ]}
          title="Support tickets"
        />
        <Card className="p-4 text-red-700 border-red-200 bg-red-50">
          {error}
        </Card>
      </main>
    );
  }

  if (rows === null) {
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[
            { label: "Home", href: "/" },
            { label: "Support tickets" },
          ]}
          title="Loading…"
        />
        <Skeleton className="h-12 w-full" rounded="rounded-lg" />
        <Skeleton className="h-64 w-full" rounded="rounded-lg" />
      </main>
    );
  }

  return (
    <main className="p-8 space-y-6">
      <PageHeader
        breadcrumb={[
          { label: "Home", href: "/" },
          { label: "Support tickets" },
        ]}
        title="Support tickets"
        subtitle="Open a request, or continue a conversation with our team."
        actions={
          <Button
            variant="primary"
            type="button"
            onClick={() => setShowForm(true)}
          >
            + New ticket
          </Button>
        }
      />

      {error && (
        <Toast
          kind="error"
          message={error}
          onDismiss={() => setError(null)}
        />
      )}

      <FilterBar
        search={{
          value: search,
          onChange: setSearch,
          placeholder: "Search subject or number…",
        }}
        filters={
          <Segmented<Tab>
            value={tab}
            onChange={setTab}
            options={[
              { value: "all", label: "All", count: counts.all },
              { value: "open", label: "Open", count: counts.open },
              { value: "closed", label: "Closed", count: counts.closed },
            ]}
          />
        }
        actions={<SavedViewsControls listKey="portal-web:tickets" current={{ search, tab }} onApply={(fv) => { setSearch(fv.search); setTab(fv.tab); }} />}
      />

      <DataTable<Ticket>
        columns={columns}
        rows={filtered}
        rowKey={(t) => t.id}
        onRowClick={(t) => openTicket(t.id)}
        empty={{
          title: "No tickets to show",
          description:
            tab === "all"
              ? "Open your first support ticket and we'll get back to you."
              : "Try switching the tab or clearing the search.",
          action: (
            <Button
              variant="primary"
              type="button"
              onClick={() => setShowForm(true)}
            >
              + New ticket
            </Button>
          ),
        }}
      />

      <Drawer
        open={showForm}
        onClose={() => setShowForm(false)}
        title="Open a new ticket"
        footer={
          <>
            <Button
              variant="secondary"
              type="button"
              onClick={() => setShowForm(false)}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="portal-new-ticket-form"
              disabled={busy}
            >
              {busy ? "Submitting…" : "Submit ticket"}
            </Button>
          </>
        }
      >
        <form
          id="portal-new-ticket-form"
          onSubmit={create}
          className="space-y-3"
        >
          <FormField label="Subject" required>
            <input
              className="input"
              value={form.subject}
              onChange={(e) => setForm({ ...form, subject: e.target.value })}
              required
            />
          </FormField>
          <FormField label="Describe the issue" required>
            <textarea
              className="input"
              rows={6}
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
              required
            />
          </FormField>
          <FormField label="Priority" required>
            <select
              className="input"
              value={form.priority}
              onChange={(e) =>
                setForm({
                  ...form,
                  priority: e.target.value as
                    | "Low"
                    | "Normal"
                    | "High"
                    | "Urgent",
                })
              }
            >
              <option>Low</option>
              <option>Normal</option>
              <option>High</option>
              <option>Urgent</option>
            </select>
          </FormField>
        </form>
      </Drawer>

      <Drawer
        open={open !== null}
        onClose={() => setOpen(null)}
        title={
          open ? (
            <span className="flex items-center gap-3">
              <span className="font-mono text-xs text-ink-muted">
                {open.name}
              </span>
              <span className="truncate">{open.subject}</span>
            </span>
          ) : (
            "Ticket"
          )
        }
        width="w-[640px]"
        footer={
          open && open.status !== "Closed" ? (
            <>
              <Button
                variant="secondary"
                type="button"
                onClick={() => setOpen(null)}
              >
                Close
              </Button>
              <Button
                variant="primary"
                type="button"
                disabled={busy || !reply.trim()}
                onClick={sendReply}
              >
                {busy ? "Sending…" : "Send reply"}
              </Button>
            </>
          ) : (
            <Button
              variant="secondary"
              type="button"
              onClick={() => setOpen(null)}
            >
              Close
            </Button>
          )
        }
      >
        {open && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 text-xs">
              <StatusBadge status={open.status} />
              <span
                className={PRIORITY_TONE[open.priority] ?? "text-ink-soft"}
              >
                {open.priority} priority
              </span>
              <span className="text-ink-muted">
                Opened {dateShort(open.createdAt)}
              </span>
            </div>

            <div className="space-y-2">
              {open.replies.map((r) => {
                const isMe = r.authorType === "portal";
                return (
                  <div
                    key={r.id}
                    className={`rounded-lg px-3 py-2 text-sm ${
                      isMe
                        ? "bg-brand-600 text-white ms-8"
                        : "bg-surface-sunken text-ink me-8 border border-ink-muted/10"
                    }`}
                  >
                    <div
                      className={`text-[10px] mb-1 ${isMe ? "text-white/70" : "text-ink-muted"}`}
                    >
                      {isMe ? "You" : "Support"} · {relativeTime(r.createdAt)}
                    </div>
                    <div className="whitespace-pre-wrap">{r.body}</div>
                  </div>
                );
              })}
              {open.replies.length === 0 && (
                <p className="text-xs text-ink-muted text-center py-6">
                  No replies yet.
                </p>
              )}
            </div>

            {open.status !== "Closed" && (
              <div>
                <FormField label="Your reply">
                  <textarea
                    className="input"
                    rows={3}
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    placeholder="Type your reply…"
                  />
                </FormField>
              </div>
            )}
          </div>
        )}
      </Drawer>
    </main>
  );
}
