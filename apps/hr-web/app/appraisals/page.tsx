"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import {
  DataTable,
  FilterBar,
  PageHeader,
  Segmented,
  StatusBadge,
  Toast,
  dateShort,
  type Column,
} from "../../components/ui";
import { Icon } from "../../components/app-shell";

interface Appraisal {
  id: string;
  name: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  finalScore: string;
  employee: { employeeCode: string; employeeName: string };
  template: { id: string; name: string } | null;
}

type StatusFilter = "all" | "Draft" | "InProgress" | "Completed" | "Cancelled";

export default function AppraisalsPage() {
  const [rows, setRows] = useState<Appraisal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        setRows(await api.get<Appraisal[]>("/appraisals"));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (q && !`${r.name} ${r.employee.employeeName} ${r.employee.employeeCode} ${r.template?.name ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, search, statusFilter]);

  const counts = useMemo(() => ({
    all:        rows.length,
    Draft:      rows.filter((r) => r.status === "Draft").length,
    InProgress: rows.filter((r) => r.status === "InProgress").length,
    Completed:  rows.filter((r) => r.status === "Completed").length,
    Cancelled:  rows.filter((r) => r.status === "Cancelled").length,
  }), [rows]);

  const columns: Column<Appraisal>[] = [
    {
      header: "Name",
      cell: (r) => (
        <a
          href={`/hr/appraisals/${r.id}`}
          className="font-mono text-sm text-brand-600 hover:text-brand-700"
          onClick={(e) => e.stopPropagation()}
        >
          {r.name}
        </a>
      ),
    },
    {
      header: "Employee",
      cell: (r) => (
        <div>
          <div className="font-medium text-ink">{r.employee.employeeName}</div>
          <div className="text-xs text-ink-muted font-mono">{r.employee.employeeCode}</div>
        </div>
      ),
    },
    {
      header: "Period",
      cell: (r) => (
        <span className="text-ink-soft">{dateShort(r.periodStart)} → {dateShort(r.periodEnd)}</span>
      ),
    },
    { header: "Template", cell: (r) => <span className="text-ink-soft">{r.template?.name ?? "Ad-hoc"}</span> },
    {
      header: "Score",
      align: "right",
      cell: (r) => <span className="tabular-nums font-medium text-ink">{Number(r.finalScore).toFixed(2)} / 5</span>,
    },
    { header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <>
      <PageHeader
        title="Appraisals"
        subtitle={`${rows.length} appraisal${rows.length === 1 ? "" : "s"}`}
        actions={<a href="/hr/appraisals/new" className="btn-brand">+ New appraisal</a>}
      />

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}

      <div className="space-y-4">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search employee or template…" }}
          filters={
            <Segmented
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: "all",        label: "All",         count: counts.all },
                { value: "Draft",      label: "Draft",       count: counts.Draft },
                { value: "InProgress", label: "In Progress", count: counts.InProgress },
                { value: "Completed",  label: "Completed",   count: counts.Completed },
                { value: "Cancelled",  label: "Cancelled",   count: counts.Cancelled },
              ]}
            />
          }
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.id}
          onRowClick={(r) => (window.location.href = `/hr/appraisals/${r.id}`)}
          loading={loading}
          empty={{
            icon: Icon.clipboard,
            title: search || statusFilter !== "all" ? "No matching appraisals" : "No appraisals yet",
            description: search || statusFilter !== "all"
              ? "Try changing your search or filter."
              : "Run performance reviews to track employee growth.",
            action: !search && statusFilter === "all" && (
              <a href="/hr/appraisals/new" className="btn-brand">+ New appraisal</a>
            ),
          }}
        />
      </div>
    </>
  );
}
