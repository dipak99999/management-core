"use client";

import { useEffect, useMemo, useState } from "react";
import { dashboardApi } from "../../../lib/dashboards";
import { AppShell, Icon } from "../../../components/app-shell";
import { SHELL_NAV } from "../../../components/shell-nav";
import {
  DataTable,
  FilterBar,
  PageHeader,
  StatusBadge,
  Toast,
  type Column,
} from "../../../components/ui";

interface Job {
  id: string;
  name: string;
  doctype: string;
  fileName: string | null;
  mode: string;
  status: string;
  dryRun: boolean;
  totalRows: number;
  succeededRows: number;
  failedRows: number;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export default function ImportJobsPage() {
  const [rows, setRows] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    (async () => {
      try {
        setRows(await dashboardApi.get<Job[]>("/imports"));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.name, r.doctype, r.fileName ?? ""].some((v) => v.toLowerCase().includes(q)),
    );
  }, [rows, search]);

  const columns: Column<Job>[] = [
    {
      header: "Name",
      cell: (r) => (
        <a
          href={`/admin/imports/${r.id}`}
          className="font-mono text-sm text-brand-600 hover:text-brand-700"
          onClick={(e) => e.stopPropagation()}
        >
          {r.name}
        </a>
      ),
    },
    { header: "Doctype", cell: (r) => <span className="font-mono text-xs text-ink-soft">{r.doctype}</span> },
    {
      header: "Mode",
      cell: (r) => (
        <span className="text-xs text-ink-soft">
          {r.mode}{r.dryRun ? " · dry-run" : ""}
        </span>
      ),
    },
    { header: "File", cell: (r) => <span className="text-xs text-ink-soft">{r.fileName ?? "—"}</span> },
    {
      header: "Rows",
      align: "right",
      cell: (r) => <span className="tabular-nums text-ink-soft">{r.totalRows}</span>,
    },
    {
      header: "OK",
      align: "right",
      cell: (r) => <span className="tabular-nums text-green-700 font-medium">{r.succeededRows}</span>,
    },
    {
      header: "Fail",
      align: "right",
      cell: (r) => <span className="tabular-nums text-red-600 font-medium">{r.failedRows}</span>,
    },
    { header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <AppShell moduleName="Home" nav={SHELL_NAV}>
      <PageHeader
        title="Import Jobs"
        subtitle={`${rows.length} import job${rows.length === 1 ? "" : "s"}`}
        breadcrumb={[{ label: "Admin", href: "/admin" }, { label: "Imports" }]}
        actions={
          <a href="/admin/imports/new" className="btn-brand">+ New import</a>
        }
      />

      {error && (
        <div className="mb-4">
          <Toast kind="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      <div className="space-y-4">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search imports…" }}
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.id}
          onRowClick={(r) => (window.location.href = `/admin/imports/${r.id}`)}
          loading={loading}
          empty={{
            icon: Icon.send,
            title: search ? "No matches" : "No imports yet",
            description: search
              ? "Try a different search term."
              : "Upload a CSV to bulk-load records.",
            action: !search && (
              <a href="/admin/imports/new" className="btn-brand">+ New import</a>
            ),
          }}
        />
      </div>
    </AppShell>
  );
}
