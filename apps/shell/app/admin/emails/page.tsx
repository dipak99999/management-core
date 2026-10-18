"use client";

import { useEffect, useState } from "react";
import { useListPageCommands, SavedViewsControls } from "@lumaara/web-ui";
import { api } from "../../../lib/api";
import { AppShell } from "../../../components/app-shell";
import { SHELL_NAV } from "../../../components/shell-nav";
import {
  Button,
  DataTable,
  FilterBar,
  PageHeader,
  StatusBadge,
  Toast,
  dateShort,
  type Column,
} from "../../../components/ui";

interface Email {
  id: string;
  toEmail: string;
  subject: string;
  status: string;
  attempts: number;
  lastError: string | null;
  sentAt: string | null;
  createdAt: string;
}

export default function EmailQueuePage() {
  const [rows, setRows] = useState<Email[]>([]);
  const [filter, setFilter] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const q = filter ? `?status=${filter}` : "";
      setRows(await api.get<Email[]>(`/emails${q}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  useListPageCommands({
    singular: "Email",
    plural: "Emails",
    refresh: load,
  });

  async function process() {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const r = await api.post<{ processed: number; sent: number; failed: number }>(
        "/emails/process",
        {},
      );
      setMsg(`Processed ${r.processed} · sent ${r.sent} · failed ${r.failed}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function cancel(id: string) {
    if (!confirm("Cancel this pending email?")) return;
    try {
      await api.post(`/emails/${id}/cancel`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  const columns: Column<Email>[] = [
    {
      header: "Created",
      cell: (r) => <span className="text-xs text-ink-soft">{dateShort(r.createdAt)}</span>,
    },
    { header: "To", cell: (r) => <span className="text-xs text-ink-soft">{r.toEmail}</span> },
    {
      header: "Subject",
      cell: (r) => (
        <div>
          <div className="text-ink">{r.subject}</div>
          {r.lastError && <div className="text-xs text-red-600">{r.lastError}</div>}
        </div>
      ),
    },
    {
      header: "Attempts",
      align: "right",
      cell: (r) => <span className="tabular-nums text-ink-soft">{r.attempts}</span>,
    },
    { header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
    {
      header: "",
      align: "right",
      cell: (r) =>
        r.status === "Pending" && (
          <button onClick={() => cancel(r.id)} className="text-red-600 text-xs hover:underline">
            Cancel
          </button>
        ),
    },
  ];

  return (
    <AppShell moduleName="Home" nav={SHELL_NAV}>
      <PageHeader
        breadcrumb={[{ label: "Admin", href: "/admin" }, { label: "Email queue" }]}
        title="Email queue"
        subtitle={`${rows.length} email${rows.length === 1 ? "" : "s"}`}
        actions={
          <Button variant="brand" onClick={process} disabled={busy} type="button">
            {busy ? "Processing…" : "Process pending"}
          </Button>
        }
      />

      {error && (
        <div className="mb-4">
          <Toast kind="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}
      {msg && (
        <div className="mb-4">
          <Toast kind="success" message={msg} />
        </div>
      )}

      <div className="max-w-5xl space-y-4">
        <FilterBar
          filters={
            <div className="flex items-center gap-2 text-sm">
              <label className="text-ink-muted">Status</label>
              <select
                className="input"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="">All</option>
                <option>Pending</option>
                <option>Sending</option>
                <option>Sent</option>
                <option>Failed</option>
                <option>Cancelled</option>
              </select>
            </div>
          }
          actions={<SavedViewsControls listKey="shell:admin-emails" current={{ filter }} onApply={(fv) => { setFilter(fv.filter); }} />}
        />

        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          loading={loading}
          empty={{ title: "No emails" }}
        />
      </div>
    </AppShell>
  );
}
