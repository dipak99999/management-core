"use client";

import { useEffect, useMemo, useState } from "react";
import { useListPageCommands, BulkActionBar, SelectCheckbox, standardBulkActions, useBulkSelect, type BulkAction, Tour, type TourStep, useRealtimeList, SavedViewsControls } from "@lumaara/web-ui";
import { api } from "../../lib/api";
import {
  Button,
  DataTable,
  Drawer,
  FilterBar,
  FormField,
  PageHeader,
  Segmented,
  StatusBadge,
  Toast,
  dateShort,
  money,
  type Column,
} from "../../components/ui";
import { Icon } from "../../components/app-shell";

interface SO {
  id: string;
  name: string;
  orderDate: string;
  deliveryDate: string | null;
  grandTotal: string;
  invoicedAmount: string;
  status: string;
  customer: { customerName: string };
  quotation: { name: string } | null;
}
interface Warehouse {
  id: string;
  warehouseName: string;
}

type StatusFilter = "all" | "Draft" | "To Deliver" | "To Bill" | "Completed" | "Cancelled";

export default function SalesOrdersPage() {
  const [rows, setRows] = useState<SO[]>([]);
  const [loading, setLoading] = useState(true);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [dnFor, setDnFor] = useState<SO | null>(null);
  const [dnWarehouseId, setDnWarehouseId] = useState("");
  const [dnBusy, setDnBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setRows(await api.get<SO[]>("/sales-orders"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    api
      .get<Warehouse[]>("/warehouses")
      .then((ws) => {
        setWarehouses(ws);
        if (ws.length) setDnWarehouseId(ws[0].id);
      })
      .catch(() => {});
  }, []);

  useListPageCommands({
    singular: "Sales Order",
    plural: "Sales Orders",
    newHref: "/crm/sales-orders/new",
    refresh: load,
  });
  useRealtimeList("sales-order", load);

  const tourSteps: TourStep[] = [
    { target: "[data-tour=crm-sales-orders-v1-header]", title: "Sales Orders", body: "This is where you manage sales orders. Filter by status, search by name, and drill into any row for details.", placement: "bottom" },
    { target: "[data-tour=crm-sales-orders-v1-new]", title: "Create a new sales order", body: "Click here to add your first sales order. The form captures all the required fields and lets you save as draft or submit immediately.", placement: "bottom" },
    { target: "[data-tour=crm-sales-orders-v1-filter]", title: "Save a filtered view", body: "Narrow down with the filters, then use the Views menu to save and name the filter set so it's one click next time.", placement: "bottom" },
  ];

  const [busyId, setBusyId] = useState<string | null>(null);

  async function submit(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (busyId) return;
    setBusyId(id);
    try {
      await api.post(`/sales-orders/${id}/submit`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submit failed");
    } finally {
      setBusyId(null);
    }
  }
  async function cancel(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (busyId) return;
    if (!confirm("Cancel this sales order? Delivery + billing pipelines will halt.")) return;
    setBusyId(id);
    try {
      await api.post(`/sales-orders/${id}/cancel`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cancel failed");
    } finally {
      setBusyId(null);
    }
  }
  async function invoice(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (busyId) return;
    setBusyId(id);
    try {
      const r = await api.post<{ salesInvoice: { name: string } }>(
        `/sales-orders/${id}/convert-to-invoice`,
        {},
      );
      setSuccess(
        `Created ${r.salesInvoice.name} as Draft. Open Accounting → Sales Invoices to submit and post GL.`,
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invoice failed");
    } finally {
      setBusyId(null);
    }
  }

  async function confirmConvertToDN() {
    if (!dnFor || !dnWarehouseId) return;
    setDnBusy(true);
    setError(null);
    try {
      const r = await api.post<{ deliveryNote: { name: string } }>(
        `/sales-orders/${dnFor.id}/convert-to-delivery-note`,
        { warehouseId: dnWarehouseId },
      );
      setDnFor(null);
      setSuccess(
        `Created ${r.deliveryNote.name} as Draft. Open Stock → Delivery Notes to submit (posts SLE + GL COGS).`,
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Convert failed");
    } finally {
      setDnBusy(false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();

    return rows.filter((s) => {
      if (statusFilter !== "all" && s.status !== statusFilter) return false;
      if (
        q &&
        !`${s.name} ${s.customer.customerName} ${s.quotation?.name ?? ""}`
          .toLowerCase()
          .includes(q)
      )
        return false;
      return true;
    });
  }, [rows, search, statusFilter]);

  const bulk = useBulkSelect(filtered);
  const bulkActions: BulkAction<SO>[] = standardBulkActions<SO>({
    base: "/sales-orders",
    api,
    onDone: load,
    clear: bulk.clear,
  });

  const counts = useMemo(
    () => ({
      all: rows.length,
      Draft: rows.filter((r) => r.status === "Draft").length,
      "To Deliver": rows.filter((r) => r.status === "To Deliver").length,
      "To Bill": rows.filter((r) => r.status === "To Bill").length,
      Completed: rows.filter((r) => r.status === "Completed").length,
      Cancelled: rows.filter((r) => r.status === "Cancelled").length,
    }),
    [rows],
  );

  const openValue = useMemo(
    () =>
      rows
        .filter((r) => r.status === "To Deliver" || r.status === "To Bill")
        .reduce((s, r) => s + Number(r.grandTotal ?? 0), 0),
    [rows],
  );

  const columns: Column<SO>[] = [
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
      cell: (s) => (
        <a
          href={`/crm/sales-orders/${s.id}`}
          className="font-mono text-sm text-brand-600 hover:text-brand-700"
          onClick={(e) => e.stopPropagation()}
        >
          {s.name}
        </a>
      ),
    },
    {
      header: "Customer",
      cell: (s) => <span className="font-medium text-ink">{s.customer.customerName}</span>,
    },
    {
      header: "From quote",
      cell: (s) => <span className="font-mono text-xs text-ink-muted">{s.quotation?.name ?? "—"}</span>,
    },
    {
      header: "Date",
      cell: (s) => <span className="text-ink-soft">{dateShort(s.orderDate)}</span>,
    },
    {
      header: "Grand total",
      align: "right",
      cell: (s) => (
        <span className="tabular-nums font-medium text-ink">
          {money(Number(s.grandTotal))}
        </span>
      ),
    },
    {
      header: "Status",
      cell: (s) => <StatusBadge status={s.status} />,
    },
    {
      header: "",
      align: "right",
      cell: (s) => (
        <div className="flex justify-end gap-2">
          {s.status === "Draft" && (
            <button
              onClick={(e) => submit(s.id, e)}
              disabled={busyId === s.id}
              className="btn-ghost btn-sm disabled:opacity-50"
            >
              {busyId === s.id ? "…" : "Submit"}
            </button>
          )}
          {(s.status === "To Deliver" || s.status === "To Bill") &&
            Number(s.invoicedAmount) < Number(s.grandTotal) && (
              <button
                onClick={(e) => invoice(s.id, e)}
                disabled={busyId === s.id}
                className="btn-ghost btn-sm disabled:opacity-50"
              >
                {busyId === s.id ? "…" : "→ Sales Invoice"}
              </button>
            )}
          {(s.status === "To Deliver" || s.status === "To Bill") && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setDnFor(s);
              }}
              disabled={busyId === s.id}
              className="btn-ghost btn-sm disabled:opacity-50"
            >
              → Delivery Note
            </button>
          )}
          {s.status !== "Cancelled" && (
            <button
              onClick={(e) => cancel(s.id, e)}
              disabled={busyId === s.id}
              className="btn-ghost btn-sm text-red-600 hover:text-red-700 disabled:opacity-50"
            >
              {busyId === s.id ? "…" : "Cancel"}
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <Tour id="crm-web.sales-orders.v1" steps={tourSteps} />
      <div data-tour="crm-sales-orders-v1-header">
      <PageHeader
        icon={Icon.cart}
        title="Sales Orders"
        subtitle={
          openValue > 0
            ? `${money(openValue)} open across ${counts["To Deliver"] + counts["To Bill"]} active order${counts["To Deliver"] + counts["To Bill"] === 1 ? "" : "s"} — orders to fulfil, deliver, and bill.`
            : "Orders to fulfil, deliver, and bill."
        }
        actions={
          <a href="/crm/sales-orders/new" className="btn-primary" data-tour="crm-sales-orders-v1-new">
            + New sales order
          </a>
        }
      />
      </div>

      {error && (
        <div className="mb-4">
          <Toast kind="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}
      {success && (
        <div className="mb-4">
          <Toast kind="success" message={success} onDismiss={() => setSuccess(null)} />
        </div>
      )}

      <div className="space-y-4">
        <div data-tour="crm-sales-orders-v1-filter">
        <FilterBar
          search={{
            value: search,
            onChange: setSearch,
            placeholder: "Search order #, customer or quote…",
          }}
          filters={
            <Segmented
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: "all", label: "All", count: counts.all },
                { value: "Draft", label: "Draft", count: counts.Draft },
                { value: "To Deliver", label: "To Deliver", count: counts["To Deliver"] },
                { value: "To Bill", label: "To Bill", count: counts["To Bill"] },
                { value: "Completed", label: "Completed", count: counts.Completed },
                { value: "Cancelled", label: "Cancelled", count: counts.Cancelled },
              ]}
            />
          }
        actions={<SavedViewsControls listKey="crm-web:sales-orders" current={{ search, statusFilter }} onApply={(f) => { setSearch(f.search); setStatusFilter(f.statusFilter); }} />}
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
          rowKey={(s) => s.id}
          onRowClick={(s) => (window.location.href = `/crm/sales-orders/${s.id}`)}
          loading={loading}
          empty={{
            icon: Icon.cart,
            title:
              search || statusFilter !== "all" ? "No matching orders" : "No sales orders yet",
            description:
              search || statusFilter !== "all"
                ? "Try changing your search or filter."
                : "Create a sales order to start fulfilment and invoicing.",
            action: !search && statusFilter === "all" && (
              <a href="/crm/sales-orders/new" className="btn-brand">
                + New sales order
              </a>
            ),
          }}
        />
      </div>

      <Drawer
        open={dnFor !== null}
        onClose={() => (dnBusy ? undefined : setDnFor(null))}
        title="Convert to Delivery Note"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDnFor(null)} disabled={dnBusy}>
              Cancel
            </Button>
            <Button
              variant="brand"
              onClick={confirmConvertToDN}
              disabled={dnBusy || !dnWarehouseId || warehouses.length === 0}
            >
              {dnBusy ? "Creating…" : "Create DN"}
            </Button>
          </>
        }
      >
        {dnFor && (
          <div className="space-y-4">
            <p className="text-sm text-ink-soft">
              Ship all items from <span className="font-mono">{dnFor.name}</span> for{" "}
              <span className="font-medium text-ink">{dnFor.customer.customerName}</span>.
            </p>
            {warehouses.length === 0 ? (
              <Toast
                kind="error"
                message="No warehouses configured. Create one in Stock → Warehouses first."
              />
            ) : (
              <FormField label="Source warehouse" required>
                <select
                  className="input"
                  value={dnWarehouseId}
                  onChange={(e) => setDnWarehouseId(e.target.value)}
                >
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.warehouseName}
                    </option>
                  ))}
                </select>
              </FormField>
            )}
          </div>
        )}
      </Drawer>
    </>
  );
}
