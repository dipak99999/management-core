"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import {
  DataTable,
  FilterBar,
  PageHeader,
  Segmented,
  Toast,
  dateShort,
  type Column,
} from "../../components/ui";
import { Icon } from "../../components/app-shell";

interface QI {
  id: string;
  name: string;
  reportDate: string;
  inspectionType: string;
  overallStatus: string;
  item: { itemCode: string; itemName: string };
}

type StatusFilter = "all" | "Accepted" | "Rejected";

export default function QIListPage() {
  const [rows, setRows] = useState<QI[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  useEffect(() => {
    setLoading(true);
    api
      .get<QI[]>("/quality-inspections")
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.overallStatus !== statusFilter) return false;
      if (q && !`${r.name} ${r.item.itemCode} ${r.item.itemName}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, search, statusFilter]);

  const counts = useMemo(() => ({
    all:      rows.length,
    Accepted: rows.filter((r) => r.overallStatus === "Accepted").length,
    Rejected: rows.filter((r) => r.overallStatus === "Rejected").length,
  }), [rows]);

  const columns: Column<QI>[] = [
    {
      header: "Inspection",
      cell: (r) => (
        <a
          href={`/stock/quality-inspections/${r.id}`}
          className="font-mono text-sm text-brand-600 hover:text-brand-700"
          onClick={(e) => e.stopPropagation()}
        >
          {r.name}
        </a>
      ),
    },
    {
      header: "Item",
      cell: (r) => (
        <span>
          <span className="font-medium text-ink">{r.item.itemName}</span>
          <span className="text-xs text-ink-muted ms-2 font-mono">{r.item.itemCode}</span>
        </span>
      ),
    },
    { header: "Type", cell: (r) => <span className="text-ink-soft">{r.inspectionType}</span> },
    { header: "Date", cell: (r) => <span className="text-ink-soft">{dateShort(r.reportDate)}</span> },
    {
      header: "Status",
      cell: (r) => (
        <span className={r.overallStatus === "Accepted" ? "badge-green" : "badge-red"}>
          {r.overallStatus}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Quality Inspections"
        subtitle={`${rows.length} inspection${rows.length === 1 ? "" : "s"}`}
        actions={
          <a href="/stock/quality-inspections/new" className="btn-brand">+ New QI</a>
        }
      />

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}

      <div className="space-y-4">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search QI # or item…" }}
          filters={
            <Segmented
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: "all",      label: "All",      count: counts.all },
                { value: "Accepted", label: "Accepted", count: counts.Accepted },
                { value: "Rejected", label: "Rejected", count: counts.Rejected },
              ]}
            />
          }
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.id}
          onRowClick={(r) => (window.location.href = `/stock/quality-inspections/${r.id}`)}
          loading={loading}
          empty={{
            icon: Icon.shield,
            title: search || statusFilter !== "all" ? "No matching inspections" : "No inspections yet",
            description: search || statusFilter !== "all"
              ? "Try changing your search or filter."
              : "Record your first quality inspection.",
            action: !search && statusFilter === "all" && (
              <a href="/stock/quality-inspections/new" className="btn-brand">+ New QI</a>
            ),
          }}
        />
      </div>
    </>
  );
}
