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

interface PRItem {
  id: string;
  qty: string;
  rate: string;
  item: { itemCode: string; itemName: string };
  warehouse: { warehouseName: string };
}
interface PR {
  id: string;
  name: string;
  postingDate: string;
  status: string;
  supplier: { supplierName: string };
  supplierDeliveryNo: string | null;
  items: PRItem[];
}

type StatusFilter = "all" | "Draft" | "Submitted" | "Cancelled";

export default function PurchaseReceiptsPage() {
  const [rows, setRows] = useState<PR[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  async function load() {
    setLoading(true);
    try {
      setRows(await api.get<PR[]>("/purchase-receipts"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  useListPageCommands({
    singular: "Purchase Receipt",
    plural: "Purchase Receipts",
    newHref: "/stock/purchase-receipts/new",
    refresh: load,
  });
  useRealtimeList("purchase-receipt", load);
  async function submit(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await api.post(`/purchase-receipts/${id}/submit`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submit failed");
    }
  }
  async function cancel(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await api.post(`/purchase-receipts/${id}/cancel`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cancel failed");
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();

    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (q && !`${r.name} ${r.supplier.supplierName} ${r.supplierDeliveryNo ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, search, statusFilter]);

  const bulk = useBulkSelect(filtered);
  const bulkActions: BulkAction<PR>[] = standardBulkActions<PR>({
    base: "/purchase-receipts",
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

  const columns: Column<PR>[] = [
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
      header: "Receipt",
      cell: (r) => (
        <a
          href={`/stock/purchase-receipts/${r.id}`}
          className="font-mono text-sm text-brand-600 hover:text-brand-700"
          onClick={(e) => e.stopPropagation()}
        >
          {r.name}
        </a>
      ),
    },
    { header: "Supplier", cell: (r) => <span className="font-medium text-ink">{r.supplier.supplierName}</span> },
    { header: "Supplier DN #", cell: (r) => <span className="text-ink-soft">{r.supplierDeliveryNo ?? "—"}</span> },
    { header: "Date", cell: (r) => <span className="text-ink-soft">{dateShort(r.postingDate)}</span> },
    {
      header: "Items",
      cell: (r) => (
        <span className="text-xs text-ink-muted">
          {r.items
            .map((i) => `${i.item.itemCode} × ${Number(i.qty)} @ ${Number(i.rate).toFixed(2)} → ${i.warehouse.warehouseName}`)
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
        title="Purchase Receipts"
        subtitle={`${rows.length} receipt${rows.length === 1 ? "" : "s"}`}
        actions={
          <a href="/stock/purchase-receipts/new" className="btn-brand">+ New receipt</a>
        }
      />

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}

      <div className="space-y-4">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search receipt # or supplier…" }}
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
          actions={<SavedViewsControls listKey="stock-web:purchase-receipts" current={{ search, statusFilter }} onApply={(fv) => { setSearch(fv.search); setStatusFilter(fv.statusFilter); }} />}
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
          onRowClick={(r) => (window.location.href = `/stock/purchase-receipts/${r.id}`)}
          loading={loading}
          empty={{
            icon: Icon.cart,
            title: search || statusFilter !== "all" ? "No matching receipts" : "No purchase receipts yet",
            description: search || statusFilter !== "all"
              ? "Try changing your search or filter."
              : "Record your first supplier delivery.",
            action: !search && statusFilter === "all" && (
              <a href="/stock/purchase-receipts/new" className="btn-brand">+ New receipt</a>
            ),
          }}
        />
      </div>
    </>
  );
}
