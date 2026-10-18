"use client";

import { useEffect, useMemo, useState } from "react";
import { useListPageCommands, Tour, type TourStep, SavedViewsControls, useRealtimeList } from "@lumaara/web-ui";
import { api } from "../../lib/api";
import {
  DataTable,
  FilterBar,
  PageHeader,
  Segmented,
  StatusBadge,
  Toast,
  type Column,
} from "../../components/ui";
import { Icon } from "../../components/app-shell";

interface WO {
  id: string;
  name: string;
  qty: string;
  producedQty: string;
  status: string;
  bom: { name: string };
  productionItem: { itemCode: string; itemName: string };
  sourceWarehouse: { warehouseName: string };
  targetWarehouse: { warehouseName: string };
}

type StatusFilter = "all" | "Draft" | "In Process" | "Completed" | "Cancelled";

export default function WorkOrdersPage() {
  const [rows, setRows] = useState<WO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  async function load() {
    setLoading(true);
    try {
      setRows(await api.get<WO[]>("/work-orders"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  useListPageCommands({
    singular: "Work Order",
    plural: "Work Orders",
    newHref: "/stock/work-orders/new",
    refresh: load,
  });
  useRealtimeList("work-order", load);
  const tourSteps: TourStep[] = [
    { target: "[data-tour=stock-work-orders-v1-header]", title: "Work Orders", body: "This is where you manage work orders. Filter by status, search by name, and drill into any row for details.", placement: "bottom" },
    { target: "[data-tour=stock-work-orders-v1-new]", title: "Create a new work order", body: "Click here to add your first work order. The form captures all the required fields and lets you save as draft or submit immediately.", placement: "bottom" },
    { target: "[data-tour=stock-work-orders-v1-filter]", title: "Save a filtered view", body: "Narrow down with the filters, then use the Views menu to save and name the filter set so it's one click next time.", placement: "bottom" },
  ];

  async function manufacture(id: string, remaining: number, ev: React.MouseEvent) {
    ev.stopPropagation();
    const input = prompt(`Qty to manufacture (remaining: ${remaining}):`, String(remaining));
    if (!input) return;
    const qty = Number(input);
    if (!Number.isFinite(qty) || qty <= 0) return;
    setBusy(id);
    setError(null);
    try {
      await api.post(`/work-orders/${id}/manufacture`, { qtyToManufacture: qty });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Manufacture failed");
    } finally {
      setBusy(null);
    }
  }

  async function cancel(id: string, reverse: boolean, ev: React.MouseEvent) {
    ev.stopPropagation();
    if (!confirm(reverse ? "Cancel + reverse all manufacturing SLEs?" : "Cancel Work Order?"))
      return;
    setError(null);
    try {
      await api.post(
        `/work-orders/${id}/${reverse ? "cancel-and-reverse" : "cancel"}`,
        {},
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cancel failed");
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (q && !`${r.name} ${r.productionItem.itemCode} ${r.productionItem.itemName}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, search, statusFilter]);

  const counts = useMemo(() => ({
    all:            rows.length,
    Draft:          rows.filter((r) => r.status === "Draft").length,
    "In Process":   rows.filter((r) => r.status === "In Process").length,
    Completed:      rows.filter((r) => r.status === "Completed").length,
    Cancelled:      rows.filter((r) => r.status === "Cancelled").length,
  }), [rows]);

  const columns: Column<WO>[] = [
    {
      header: "Work Order",
      cell: (r) => (
        <a
          href={`/stock/work-orders/${r.id}`}
          className="font-mono text-sm text-brand-600 hover:text-brand-700"
          onClick={(e) => e.stopPropagation()}
        >
          {r.name}
        </a>
      ),
    },
    {
      header: "Produces",
      cell: (r) => (
        <span className="font-medium text-ink">
          {r.productionItem.itemCode} — {r.productionItem.itemName}
        </span>
      ),
    },
    {
      header: "BOM",
      cell: (r) => <span className="font-mono text-xs text-ink-muted">{r.bom.name}</span>,
    },
    {
      header: "Source → Target",
      cell: (r) => (
        <span className="text-xs text-ink-muted">
          {r.sourceWarehouse.warehouseName} → {r.targetWarehouse.warehouseName}
        </span>
      ),
    },
    {
      header: "Qty (done/total)",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-ink">
          {Number(r.producedQty)} / {Number(r.qty)}
        </span>
      ),
    },
    { header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
    {
      header: "",
      align: "right",
      cell: (r) => {
        const done = Number(r.producedQty);
        const total = Number(r.qty);
        const remaining = total - done;
        return (
          <span className="space-x-2">
            {r.status !== "Cancelled" && r.status !== "Completed" && (
              <button
                onClick={(e) => manufacture(r.id, remaining, e)}
                disabled={busy === r.id}
                className="btn-ghost btn-sm disabled:opacity-50"
              >
                Manufacture
              </button>
            )}
            {r.status !== "Cancelled" && (
              <>
                <button onClick={(e) => cancel(r.id, false, e)} className="btn-ghost btn-sm text-red-600">
                  Cancel
                </button>
                {done > 0 && (
                  <button
                    onClick={(e) => cancel(r.id, true, e)}
                    className="btn-ghost btn-sm text-red-700"
                    title="Also reverse all manufacturing SLEs"
                  >
                    + reverse
                  </button>
                )}
              </>
            )}
          </span>
        );
      },
    },
  ];

  return (
    <>
      <Tour id="stock-web.work-orders.v1" steps={tourSteps} />
      <div data-tour="stock-work-orders-v1-header">
      <PageHeader
        icon={Icon.factory}
        title="Production"
        subtitle={`${rows.length} work order${rows.length === 1 ? "" : "s"} — all work orders and job cards. Click one to run it on the flow screen.`}
        actions={
          <a href="/stock/work-orders/new" className="btn-primary" data-tour="stock-work-orders-v1-new">
            + New work order
          </a>
        }
      />
      </div>

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}

      <div className="space-y-4">
        <div data-tour="stock-work-orders-v1-filter">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search WO # or produced item…" }}
          filters={
            <Segmented
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: "all",         label: "All",         count: counts.all },
                { value: "Draft",       label: "Draft",       count: counts.Draft },
                { value: "In Process",  label: "In Process",  count: counts["In Process"] },
                { value: "Completed",   label: "Completed",   count: counts.Completed },
                { value: "Cancelled",   label: "Cancelled",   count: counts.Cancelled },
              ]}
            />
          }
        actions={<SavedViewsControls listKey="stock-web:work-orders" current={{ search, statusFilter }} onApply={(f) => { setSearch(f.search); setStatusFilter(f.statusFilter); }} />}
        />
          </div>
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.id}
          onRowClick={(r) => (window.location.href = `/stock/work-orders/${r.id}`)}
          loading={loading}
          empty={{
            icon: Icon.settings,
            title: search || statusFilter !== "all" ? "No matching work orders" : "No work orders yet",
            description: search || statusFilter !== "all"
              ? "Try changing your search or filter."
              : "Create your first work order from a BOM.",
            action: !search && statusFilter === "all" && (
              <a href="/stock/work-orders/new" className="btn-brand">+ New work order</a>
            ),
          }}
        />
      </div>
    </>
  );
}
