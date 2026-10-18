"use client";

import { useEffect, useMemo, useState } from "react";
import { useListPageCommands, SavedViewsControls, useRealtimeList } from "@lumaara/web-ui";
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

interface SRRow {
  id: string;
  name: string;
  postingDate: string;
  purpose: string;
  status: string;
}

type StatusFilter = "all" | "Draft" | "Submitted" | "Cancelled";

export default function StockReconciliationsPage() {
  const [rows, setRows] = useState<SRRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  async function load() {
    setLoading(true);
    try {
      setRows(await api.get<SRRow[]>("/stock-reconciliations"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  useListPageCommands({
    singular: "Stock Reconciliation",
    plural: "Stock Reconciliations",
    newHref: "/stock/stock-reconciliations/new",
    refresh: load,
  });
  useRealtimeList("stock-reconciliation", load);
  async function submit(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await api.post(`/stock-reconciliations/${id}/submit`, {});
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (q && !`${r.name} ${r.purpose}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, search, statusFilter]);

  const counts = useMemo(() => ({
    all:       rows.length,
    Draft:     rows.filter((r) => r.status === "Draft").length,
    Submitted: rows.filter((r) => r.status === "Submitted").length,
    Cancelled: rows.filter((r) => r.status === "Cancelled").length,
  }), [rows]);

  const columns: Column<SRRow>[] = [
    {
      header: "Reconciliation",
      cell: (r) => (
        <a
          href={`/stock/stock-reconciliations/${r.id}`}
          className="font-mono text-sm text-brand-600 hover:text-brand-700"
          onClick={(e) => e.stopPropagation()}
        >
          {r.name}
        </a>
      ),
    },
    { header: "Purpose", cell: (r) => <span className="text-ink-soft">{r.purpose}</span> },
    { header: "Date", cell: (r) => <span className="text-ink-soft">{dateShort(r.postingDate)}</span> },
    { header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
    {
      header: "",
      align: "right",
      cell: (r) =>
        r.status === "Draft" ? (
          <button onClick={(e) => submit(r.id, e)} className="btn-ghost btn-sm">Submit</button>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title="Stock Reconciliations"
        subtitle={`${rows.length} reconciliation${rows.length === 1 ? "" : "s"}`}
        actions={
          <a href="/stock/stock-reconciliations/new" className="btn-brand">+ New SR</a>
        }
      />

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}

      <div className="space-y-4">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search SR # or purpose…" }}
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
          actions={<SavedViewsControls listKey="stock-web:stock-reconciliations" current={{ search, statusFilter }} onApply={(fv) => { setSearch(fv.search); setStatusFilter(fv.statusFilter); }} />}
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.id}
          onRowClick={(r) => (window.location.href = `/stock/stock-reconciliations/${r.id}`)}
          loading={loading}
          empty={{
            icon: Icon.clipboard,
            title: search || statusFilter !== "all" ? "No matching reconciliations" : "No reconciliations yet",
            description: search || statusFilter !== "all"
              ? "Try changing your search or filter."
              : "Reconcile physical stock with book quantities.",
            action: !search && statusFilter === "all" && (
              <a href="/stock/stock-reconciliations/new" className="btn-brand">+ New SR</a>
            ),
          }}
        />
      </div>
    </>
  );
}
