"use client";

import { useEffect, useState } from "react";
import { DocActivityPanel } from "@lumaara/web-ui";
import { useParams } from "next/navigation";
import { dashboardApi } from "../../../../lib/dashboards";
import { AppShell } from "../../../../components/app-shell";
import { SHELL_NAV } from "../../../../components/shell-nav";
import {
  Button,
  Card,
  FormField,
  PageHeader,
  SectionHeader,
  Skeleton,
  StatusBadge,
  Toast,
  dateShort,
} from "../../../../components/ui";

interface Reply {
  id: string;
  body: string;
  authorType: "portal" | "staff";
  authorId: string;
  createdAt: string;
}
interface Ticket {
  id: string;
  name: string;
  subject: string;
  status: string;
  priority: string;
  partyType: string;
  partyId: string;
  createdAt: string;
  updatedAt: string;
  portalUser: { email: string; displayName: string | null };
  replies: Reply[];
}

export default function StaffTicketDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [reply, setReply] = useState("");
  const [nextStatus, setNextStatus] = useState<"Answered" | "Closed" | "Open">(
    "Answered",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setTicket(await dashboardApi.get<Ticket>(`/staff-tickets/${id}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function submitReply() {
    setBusy(true);
    setError(null);
    try {
      await dashboardApi.post(`/staff-tickets/${id}/reply`, {
        body: reply,
        setStatus: nextStatus,
      });
      setReply("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function setStatusOnly(status: "Open" | "Answered" | "Closed") {
    setBusy(true);
    setError(null);
    try {
      await dashboardApi.post(`/staff-tickets/${id}/status`, { status });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const breadcrumb = [
    { label: "Admin", href: "/admin" },
    { label: "Tickets", href: "/admin/tickets" },
    { label: ticket?.name ?? "Ticket" },
  ];

  if (!ticket) {
    return (
      <AppShell moduleName="Home" nav={SHELL_NAV}>
        <PageHeader breadcrumb={breadcrumb} title="Loading ticket…" />
        {error ? (
          <Card className="p-4 text-red-700 border-red-200 bg-red-50">{error}</Card>
        ) : (
          <Skeleton className="h-64" rounded="rounded-lg" />
        )}
      </AppShell>
    );
  }

  return (
    <AppShell moduleName="Home" nav={SHELL_NAV}>
      <PageHeader
        breadcrumb={breadcrumb}
        title={ticket.subject}
        subtitle={
          <span className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-xs">{ticket.name}</span>
            <span className="text-ink-muted">·</span>
            <StatusBadge status={ticket.status} />
            <span className="text-ink-muted">·</span>
            <span>Priority {ticket.priority}</span>
            <span className="text-ink-muted">·</span>
            <span>
              From {ticket.portalUser.displayName ?? ticket.portalUser.email} (
              {ticket.partyType})
            </span>
          </span>
        }
        actions={
          <>
            <Button variant="secondary" onClick={() => history.back()} type="button">
              ← Back
            </Button>
            {ticket.status !== "Closed" && (
              <Button
                variant="secondary"
                onClick={() => setStatusOnly("Closed")}
                disabled={busy}
                type="button"
              >
                Close
              </Button>
            )}
            {ticket.status === "Closed" && (
              <Button
                variant="secondary"
                onClick={() => setStatusOnly("Open")}
                disabled={busy}
                type="button"
              >
                Reopen
              </Button>
            )}
          </>
        }
      />

      {error && (
        <div className="mb-4">
          <Toast kind="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      <div className="max-w-3xl space-y-4">
        <section>
          <SectionHeader title="Conversation" />
          <div className="space-y-3">
            {ticket.replies.map((r) => (
              <Card
                key={r.id}
                className={`p-3 ${
                  r.authorType === "staff"
                    ? "bg-brand-50 border-brand-200"
                    : ""
                }`}
              >
                <div className="text-xs text-ink-muted mb-1 flex items-center justify-between">
                  <span>
                    {r.authorType === "staff" ? "Staff" : "Customer/Supplier"}
                  </span>
                  <span>{dateShort(r.createdAt)}</span>
                </div>
                <div className="whitespace-pre-wrap text-sm text-ink">{r.body}</div>
              </Card>
            ))}
            {ticket.replies.length === 0 && (
              <div className="text-sm text-ink-muted">No replies yet.</div>
            )}
          </div>
        </section>

        {ticket.status !== "Closed" && (
          <Card className="p-4 space-y-3">
            <SectionHeader title="Reply" />
            <FormField label="Message">
              <textarea
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                rows={5}
                className="input"
                placeholder="Type your reply…"
              />
            </FormField>
            <div className="flex items-center gap-3">
              <label className="text-xs text-ink-muted">After send, set to:</label>
              <select
                value={nextStatus}
                onChange={(e) =>
                  setNextStatus(e.target.value as "Open" | "Answered" | "Closed")
                }
                className="input w-32"
              >
                <option value="Answered">Answered</option>
                <option value="Open">Open</option>
                <option value="Closed">Closed</option>
              </select>
              <Button
                variant="brand"
                onClick={submitReply}
                disabled={busy || reply.trim().length === 0}
                className="ms-auto"
                type="button"
              >
                {busy ? "Sending…" : "Send reply"}
              </Button>
            </div>
          </Card>
        )}
      </div>
    
      <div className="rounded-xl border border-ink/10 bg-canvas p-4 mt-6">
        <h3 className="text-sm font-semibold text-ink mb-3">Activity</h3>
        <DocActivityPanel doctype="SupportTicket" docId={id} />
      </div>
</AppShell>
  );
}
