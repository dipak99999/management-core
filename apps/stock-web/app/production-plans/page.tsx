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

interface PP {
  id: string;
  name: string;
  postingDate: string;
  status: string;
  items: { plannedQty: string; producedQty: string }[];
}

type StatusFilter = "all" | "Draft" | "Submitted" | "Cancelled";

export default function ProductionPlansPage() {
  const [rows, setRows] = useState<PP[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  useEffect(() => {
    setLoading(true);
    api
      .get<PP[]>("/production-plans")
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (q && !r.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, search, statusFilter]);

  const counts = useMemo(() => ({
    all:       rows.length,
    Draft:     rows.filter((r) => r.status === "Draft").length,
    Submitted: rows.filter((r) => r.status === "Submitted").length,
    Cancelled: rows.filter((r) => r.status === "Cancelled").length,
  }), [rows]);

  const columns: Column<PP>[] = [
    {
      header: "Plan",
      cell: (p) => (
        <a
          href={`/stock/production-plans/${p.id}`}
          className="font-mono text-sm text-brand-600 hover:text-brand-700"
          onClick={(e) => e.stopPropagation()}
        >
          {p.name}
        </a>
      ),
    },
    { header: "Date", cell: (p) => <span className="text-ink-soft">{dateShort(p.postingDate)}</span> },
    {
      header: "Lines",
      align: "right",
      cell: (p) => <span className="tabular-nums text-ink-soft">{p.items.length}</span>,
    },
    { header: "Status", cell: (p) => <StatusBadge status={p.status} /> },
  ];

  return (
    <>
      <PageHeader
        title="Production Plans"
        subtitle={`${rows.length} plan${rows.length === 1 ? "" : "s"}`}
        actions={
          <a href="/stock/production-plans/new" className="btn-brand">+ New plan</a>
        }
      />

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}

      <div className="space-y-4">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search plan #…" }}
          filters={
            <Segmented
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: "all",       label: "All",       count: counts.all },
                { value: "Draft",     label: "Draft",     count: counts.Draft },
                { value: "Submitted", label: "Submitted", count: counts.Submitted },
                { value: "Cancelled", label: "Cancelled", count: counts.Cancelled },
              ]}
            />
          }
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(p) => p.id}
          onRowClick={(p) => (window.location.href = `/stock/production-plans/${p.id}`)}
          loading={loading}
          empty={{
            icon: Icon.calendar,
            title: search || statusFilter !== "all" ? "No matching plans" : "No production plans yet",
            description: search || statusFilter !== "all"
              ? "Try changing your search or filter."
              : "Draft a production plan to schedule work orders.",
            action: !search && statusFilter === "all" && (
              <a href="/stock/production-plans/new" className="btn-brand">+ New plan</a>
            ),
          }}
        />
      </div>
    </>
  );
}
