"use client";

import { useEffect, useMemo, useState } from "react";
import { useListPageCommands, BulkActionBar, SelectCheckbox, standardBulkActions, useBulkSelect, type BulkAction, Tour, type TourStep, useRealtimeList, SavedViewsControls } from "@lumaara/web-ui";
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

interface MRItem { qty: string; orderedQty: string }
interface MRRow {
  id: string;
  name: string;
  transactionDate: string;
  requiredDate: string | null;
  materialRequestType: string;
  status: string;
  items: MRItem[];
}

type StatusFilter = "all" | "Draft" | "Submitted" | "Ordered" | "Received" | "Cancelled";

function fulfillmentPct(items: MRItem[]) {
  const total = items.reduce((s, i) => s + Number(i.qty), 0);
  const ord = items.reduce((s, i) => s + Number(i.orderedQty), 0);
  return { total, ord, pct: total > 0 ? Math.round((ord / total) * 100) : 0 };
}

export default function MaterialRequestsPage() {
  const [rows, setRows] = useState<MRRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  async function load() {
    setLoading(true);
    try {
      setRows(await api.get<MRRow[]>("/material-requests"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  useListPageCommands({
    singular: "Material Request",
    plural: "Material Requests",
    newHref: "/stock/material-requests/new",
    refresh: load,
  });
  useRealtimeList("material-request", load);

  const tourSteps: TourStep[] = [
    { target: "[data-tour=stock-material-requests-v1-header]", title: "Material Requests", body: "This is where you manage material requests. Filter by status, search by name, and drill into any row for details.", placement: "bottom" },
    { target: "[data-tour=stock-material-requests-v1-new]", title: "Create a new material request", body: "Click here to add your first material request. The form captures all the required fields and lets you save as draft or submit immediately.", placement: "bottom" },
    { target: "[data-tour=stock-material-requests-v1-filter]", title: "Save a filtered view", body: "Narrow down with the filters, then use the Views menu to save and name the filter set so it's one click next time.", placement: "bottom" },
  ];

  async function submit(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    await api.post(`/material-requests/${id}/submit`, {});
    await load();
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();

    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (q && !`${r.name} ${r.materialRequestType}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, search, statusFilter]);

  const bulk = useBulkSelect(filtered);
  const bulkActions: BulkAction<MRRow>[] = standardBulkActions<MRRow>({
    base: "/material-requests",
    api,
    onDone: load,
    clear: bulk.clear,
  });

  const counts = useMemo(() => ({
    all:       rows.length,
    Draft:     rows.filter((r) => r.status === "Draft").length,
    Submitted: rows.filter((r) => r.status === "Submitted").length,
    Ordered:   rows.filter((r) => r.status === "Ordered").length,
    Received:  rows.filter((r) => r.status === "Received").length,
    Cancelled: rows.filter((r) => r.status === "Cancelled").length,
  }), [rows]);

  const columns: Column<MRRow>[] = [
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
      header: "MR",
      cell: (r) => (
        <a
          href={`/stock/material-requests/${r.id}`}
          className="font-mono text-sm text-brand-600 hover:text-brand-700"
          onClick={(e) => e.stopPropagation()}
        >
          {r.name}
        </a>
      ),
    },
    { header: "Type", cell: (r) => <span className="text-ink-soft">{r.materialRequestType}</span> },
    { header: "Date", cell: (r) => <span className="text-ink-soft">{dateShort(r.transactionDate)}</span> },
    { header: "Required", cell: (r) => <span className="text-ink-soft">{dateShort(r.requiredDate)}</span> },
    {
      header: "Fulfilled",
      align: "right",
      cell: (r) => {
        const p = fulfillmentPct(r.items);
        return (
          <span className="tabular-nums text-ink-soft">
            {p.ord.toFixed(2)} / {p.total.toFixed(2)} ({p.pct}%)
          </span>
        );
      },
    },
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
      <Tour id="stock-web.material-requests.v1" steps={tourSteps} />
      <div data-tour="stock-material-requests-v1-header">
      <PageHeader
        title="Material Requests"
        subtitle={`${rows.length} material request${rows.length === 1 ? "" : "s"}`}
        actions={
          <a href="/stock/material-requests/new" className="btn-brand" data-tour="stock-material-requests-v1-new">+ New MR</a>
        }
      />
      </div>

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}

      <div className="space-y-4">
        <div data-tour="stock-material-requests-v1-filter">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search MR # or type…" }}
          filters={
            <Segmented
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: "all",       label: "All",       count: counts.all },
                { value: "Draft",     label: "Draft",     count: counts.Draft },
                { value: "Submitted", label: "Submitted", count: counts.Submitted },
                { value: "Ordered",   label: "Ordered",   count: counts.Ordered },
                { value: "Received",  label: "Received",  count: counts.Received },
                { value: "Cancelled", label: "Cancelled", count: counts.Cancelled },
              ]}
            />
          }
        actions={<SavedViewsControls listKey="stock-web:material-requests" current={{ search, statusFilter }} onApply={(f) => { setSearch(f.search); setStatusFilter(f.statusFilter); }} />}
        />
          </div>
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
          onRowClick={(r) => (window.location.href = `/stock/material-requests/${r.id}`)}
          loading={loading}
          empty={{
            icon: Icon.clipboard,
            title: search || statusFilter !== "all" ? "No matching MRs" : "No material requests yet",
            description: search || statusFilter !== "all"
              ? "Try changing your search or filter."
              : "Raise a material request to plan procurement.",
            action: !search && statusFilter === "all" && (
              <a href="/stock/material-requests/new" className="btn-brand">+ New MR</a>
            ),
          }}
        />
      </div>
    </>
  );
}
