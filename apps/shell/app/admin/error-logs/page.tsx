"use client";

import { useEffect, useState } from "react";
import { useListPageCommands } from "@lumaara/web-ui";
import { dashboardApi } from "../../../lib/dashboards";
import { AppShell } from "../../../components/app-shell";
import { SHELL_NAV } from "../../../components/shell-nav";
import {
  Button,
  DataTable,
  Drawer,
  PageHeader,
  Toast,
  dateShort,
  type Column,
} from "../../../components/ui";

interface ErrLog {
  id: string;
  service: string;
  requestId: string | null;
  path: string;
  method: string;
  statusCode: number;
  message: string;
  stack: string | null;
  userId: string | null;
  createdAt: string;
}

export default function ErrorLogsPage() {
  const [rows, setRows] = useState<ErrLog[]>([]);
  const [open, setOpen] = useState<ErrLog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      setRows(await dashboardApi.get<ErrLog[]>("/error-logs"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  useListPageCommands({
    singular: "Error Log",
    plural: "Error Logs",
    refresh: load,
  });

  async function prune() {
    if (!confirm("Delete error logs older than 30 days?")) return;
    setBusy(true);
    try {
      await dashboardApi.delete("/error-logs?olderThanDays=30");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<ErrLog>[] = [
    { header: "When", cell: (r) => <span className="text-xs text-ink-soft">{dateShort(r.createdAt)}</span> },
    { header: "Service", cell: (r) => <span className="text-xs font-mono text-ink-soft">{r.service}</span> },
    { header: "Method", cell: (r) => <span className="text-xs text-ink-soft">{r.method}</span> },
    { header: "Path", cell: (r) => <span className="text-xs break-all text-ink-soft">{r.path}</span> },
    { header: "Status", align: "right", cell: (r) => <span className="tabular-nums text-xs text-ink-soft">{r.statusCode}</span> },
    { header: "Message", cell: (r) => <span className="text-xs text-red-700">{r.message}</span> },
  ];

  return (
    <AppShell moduleName="Home" nav={SHELL_NAV}>
      <PageHeader
        breadcrumb={[{ label: "Admin", href: "/admin" }, { label: "Error logs" }]}
        title="Error logs"
        subtitle={`${rows.length} recent event${rows.length === 1 ? "" : "s"}`}
        actions={
          <Button variant="danger" onClick={prune} disabled={busy} type="button">
            Prune older than 30 days
          </Button>
        }
      />

      {error && (
        <div className="mb-4">
          <Toast kind="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      <div className="max-w-6xl">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          onRowClick={(r) => setOpen(r)}
          loading={loading}
          empty={{ title: "No errors captured" }}
        />
      </div>

      {open && (
        <Drawer
          open
          onClose={() => setOpen(null)}
          title={open.message}
          width="w-[720px]"
        >
          <div className="space-y-3 text-sm">
            <div className="font-mono text-xs text-ink-muted">{open.requestId}</div>
            <div className="text-xs text-ink-muted">
              {open.service} · {open.method} {open.path} · HTTP {open.statusCode}
            </div>
            {open.stack && (
              <pre className="bg-surface-sunken p-3 text-xs overflow-x-auto whitespace-pre-wrap rounded">
                {open.stack}
              </pre>
            )}
          </div>
        </Drawer>
      )}
    </AppShell>
  );
}
