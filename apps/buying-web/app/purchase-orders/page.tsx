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
  money,
  type Column,
} from "../../components/ui";
import { useListPageCommands, BulkActionBar, SelectCheckbox, standardBulkActions, useBulkSelect, type BulkAction, Tour, type TourStep, useRealtimeList, SavedViewsControls } from "@lumaara/web-ui";
import { Icon } from "../../components/app-shell";

interface POItem {
  qty: string;
  receivedQty: string;
}
interface PORow {
  id: string;
  name: string;
  transactionDate: string;
  status: string;
  grandTotal: string;
  currency?: string;
  supplier: { supplierName: string };
  items: POItem[];
}

type StatusFilter = "all" | "Draft" | "To Receive" | "Completed" | "Cancelled";

function receivedProgress(items: POItem[]) {
  const total = items.reduce((s, i) => s + Number(i.qty), 0);
  const rec = items.reduce((s, i) => s + Number(i.receivedQty), 0);
  return { total, rec, pct: total > 0 ? Math.round((rec / total) * 100) : 0 };
}

export default function PurchaseOrdersPage() {
  const [rows, setRows] = useState<PORow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  async function load() {
    setLoading(true);
    try {
      setRows(await api.get<PORow[]>("/purchase-orders"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  useListPageCommands({
    singular: "Purchase Order",
    plural: "Purchase Orders",
    newHref: "/buying/purchase-orders/new",
    refresh: load,
  });
  useRealtimeList("purchase-order", load);

  const tourSteps: TourStep[] = [
    { target: "[data-tour=buying-purchase-orders-v1-header]", title: "Purchase Orders", body: "This is where you manage purchase orders. Filter by status, search by name, and drill into any row for details.", placement: "bottom" },
    { target: "[data-tour=buying-purchase-orders-v1-new]", title: "Create a new purchase order", body: "Click here to add your first purchase order. The form captures all the required fields and lets you save as draft or submit immediately.", placement: "bottom" },
    { target: "[data-tour=buying-purchase-orders-v1-filter]", title: "Save a filtered view", body: "Narrow down with the filters, then use the Views menu to save and name the filter set so it's one click next time.", placement: "bottom" },
  ];

  async function submit(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    await api.post(`/purchase-orders/${id}/submit`, {});
    await load();
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (q && !`${r.name} ${r.supplier.supplierName}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, search, statusFilter]);

  const bulk = useBulkSelect(filtered);
  const bulkActions: BulkAction<PORow>[] = standardBulkActions<PORow>({
    base: "/purchase-orders",
    api,
    onDone: load,
    clear: bulk.clear,
  });

  const counts = useMemo(() => ({
    all:          rows.length,
    Draft:        rows.filter((r) => r.status === "Draft").length,
    "To Receive": rows.filter((r) => r.status === "To Receive").length,
    Completed:    rows.filter((r) => r.status === "Completed").length,
    Cancelled:    rows.filter((r) => r.status === "Cancelled").length,
  }), [rows]);

  const openValue = useMemo(
    () => rows
      .filter((r) => r.status === "To Receive")
      .reduce((s, r) => s + Number(r.grandTotal ?? 0), 0),
    [rows],
  );

  const columns: Column<PORow>[] = [
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
      header: "Order",
      cell: (r) => (
        <a
          href={`/buying/purchase-orders/${r.id}`}
          className="font-mono text-sm text-brand-600 hover:text-brand-700"
          onClick={(e) => e.stopPropagation()}
        >
          {r.name}
        </a>
      ),
    },
    {
      header: "Supplier",
      cell: (r) => <span className="font-medium text-ink">{r.supplier.supplierName}</span>,
    },
    {
      header: "Date",
      cell: (r) => <span className="text-ink-soft">{dateShort(r.transactionDate)}</span>,
    },
    {
      header: "Amount",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums font-medium text-ink">
          {money(Number(r.grandTotal), r.currency ?? "INR")}
        </span>
      ),
    },
    {
      header: "Received",
      cell: (r) => {
        const p = receivedProgress(r.items);
        return (
          <span className="text-xs text-ink-soft tabular-nums">
            {p.rec.toFixed(2)} / {p.total.toFixed(2)} ({p.pct}%)
          </span>
        );
      },
    },
    {
      header: "Status",
      cell: (r) => <StatusBadge status={r.status} />,
    },
    {
      header: "",
      align: "right",
      cell: (r) =>
        r.status === "Draft" ? (
          <button onClick={(e) => submit(r.id, e)} className="btn-ghost btn-sm">
            Submit
          </button>
        ) : null,
    },
  ];

  return (
    <>
      <Tour id="buying-web.purchase-orders.v1" steps={tourSteps} />
      <div data-tour="buying-purchase-orders-v1-header">
      <PageHeader
        title="Purchase Orders"
        subtitle={
          openValue > 0
            ? `${money(openValue)} open across ${counts["To Receive"]} order${counts["To Receive"] === 1 ? "" : "s"}`
            : `${rows.length} order${rows.length === 1 ? "" : "s"}`
        }
        actions={
          <a href="/buying/purchase-orders/new" className="btn-brand" data-tour="buying-purchase-orders-v1-new">+ New PO</a>
        }
      />
      </div>

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}

      <div className="space-y-4">
        <div data-tour="buying-purchase-orders-v1-filter">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search PO # or supplier…" }}
          filters={
            <Segmented
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: "all",        label: "All",        count: counts.all },
                { value: "Draft",      label: "Draft",      count: counts.Draft },
                { value: "To Receive", label: "To Receive", count: counts["To Receive"] },
                { value: "Completed",  label: "Completed",  count: counts.Completed },
                { value: "Cancelled",  label: "Cancelled",  count: counts.Cancelled },
              ]}
            />
          }
          actions={<SavedViewsControls listKey="buying-web:purchase-orders" current={{ search, statusFilter }} onApply={(f) => { setSearch(f.search); setStatusFilter(f.statusFilter); }} />}
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
          onRowClick={(r) => (window.location.href = `/buying/purchase-orders/${r.id}`)}
          loading={loading}
          empty={{
            icon: Icon.cart,
            title: search || statusFilter !== "all" ? "No matching orders" : "No purchase orders yet",
            description: search || statusFilter !== "all"
              ? "Try changing your search or filter."
              : "Create your first purchase order.",
            action: !search && statusFilter === "all" && (
              <a href="/buying/purchase-orders/new" className="btn-brand">+ New PO</a>
            ),
          }}
        />
      </div>
    </>
  );
}
