"use client";

import { useEffect, useMemo, useState } from "react";
import { useListPageCommands, BulkActionBar, SelectCheckbox, standardBulkActions, useBulkSelect, type BulkAction, SavedViewsControls, useRealtimeList } from "@lumaara/web-ui";
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

interface SEItem {
  id: string;
  qty: string;
  item: { itemCode: string; itemName: string };
  sourceWarehouse: { warehouseName: string } | null;
  targetWarehouse: { warehouseName: string } | null;
}
interface SE {
  id: string;
  name: string;
  entryType: string;
  postingDate: string;
  status: string;
  items: SEItem[];
}

type StatusFilter = "all" | "Draft" | "Submitted" | "Cancelled";

export default function StockEntriesPage() {
  const [rows, setRows] = useState<SE[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  async function load() {
    setLoading(true);
    try {
      setRows(await api.get<SE[]>("/stock-entries"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  useListPageCommands({
    singular: "Stock Entry",
    plural: "Stock Entries",
    newHref: "/stock/stock-entries/new",
    refresh: load,
  });
  useRealtimeList("stock-entry", load);
  async function submit(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await api.post(`/stock-entries/${id}/submit`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submit failed");
    }
  }
  async function cancel(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await api.post(`/stock-entries/${id}/cancel`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cancel failed");
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();

    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (q && !`${r.name} ${r.entryType}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, search, statusFilter]);

  const bulk = useBulkSelect(filtered);
  const bulkActions: BulkAction<SE>[] = standardBulkActions<SE>({
    base: "/stock-entries",
    api,
    onDone: load,
    clear: bulk.clear,
  });

  const counts = useMemo(() => ({
    all:       rows.length,
    Draft:     rows.filter((r) => r.status === "Draft").length,
    Submitted: rows.filter((r) => r.status === "Submitted").length,
    Cancelled: rows.filter((r) => r.status === "Cancelled").length,
  }), [rows]);

  const columns: Column<SE>[] = [
    {
      header: (
        <SelectCheckbox
          checked={bulk.allSelected}
          indeterminate={bulk.someSelected}
          onChange={bulk.toggleAll}
          aria-label="Select all"
        />
      ),
      cell: (r) => (
        <SelectCheckbox
          checked={bulk.isSelected(r.id)}
          onChange={() => bulk.toggle(r.id)}
          aria-label="Select row"
        />
      ),
    },
    {
      header: "Entry",
      cell: (r) => (
        <a
          href={`/stock/stock-entries/${r.id}`}
          className="font-mono text-sm text-brand-600 hover:text-brand-700"
          onClick={(e) => e.stopPropagation()}
        >
          {r.name}
        </a>
      ),
    },
    { header: "Type", cell: (r) => <span className="text-ink-soft">{r.entryType}</span> },
    { header: "Date", cell: (r) => <span className="text-ink-soft">{dateShort(r.postingDate)}</span> },
    {
      header: "Items",
      cell: (r) => (
        <span className="text-xs text-ink-muted">
          {r.items
            .map((i) => {
              const from = i.sourceWarehouse?.warehouseName;
              const to = i.targetWarehouse?.warehouseName;
              const flow = from && to ? `${from} → ${to}` : from ?? to ?? "";
              return `${i.item.itemCode} × ${Number(i.qty)} (${flow})`;
            })
            .join(", ")}
        </span>
      ),
    },
    { header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <span className="space-x-2">
          {r.status === "Draft" && (
            <button onClick={(e) => submit(r.id, e)} className="btn-ghost btn-sm">Submit</button>
          )}
          {r.status !== "Cancelled" && (
            <button onClick={(e) => cancel(r.id, e)} className="btn-ghost btn-sm text-red-600">Cancel</button>
          )}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Stock Entries"
        subtitle={`${rows.length} entr${rows.length === 1 ? "y" : "ies"}`}
        actions={
          <a href="/stock/stock-entries/new" className="btn-brand">+ New entry</a>
        }
      />

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}

      <div className="space-y-4">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search entry # or type…" }}
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
          actions={<SavedViewsControls listKey="stock-web:stock-entries" current={{ search, statusFilter }} onApply={(fv) => { setSearch(fv.search); setStatusFilter(fv.statusFilter); }} />}
        />
        <BulkActionBar
          count={bulk.selectedRows.length}
          selected={bulk.selectedRows}
          actions={bulkActions}
          onClear={bulk.clear}
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.id}
          onRowClick={(r) => (window.location.href = `/stock/stock-entries/${r.id}`)}
          loading={loading}
          empty={{
            icon: Icon.box,
            title: search || statusFilter !== "all" ? "No matching entries" : "No stock entries yet",
            description: search || statusFilter !== "all"
              ? "Try changing your search or filter."
              : "Record your first stock movement.",
            action: !search && statusFilter === "all" && (
              <a href="/stock/stock-entries/new" className="btn-brand">+ New entry</a>
            ),
          }}
        />
      </div>
    </>
  );
}
