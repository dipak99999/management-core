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
import { CalendarView } from "../../components/calendar";

interface DNItem {
  id: string;
  qty: string;
  rate: string;
  item: { itemCode: string; itemName: string };
  warehouse: { warehouseName: string };
}
interface DN {
  id: string;
  name: string;
  postingDate: string;
  status: string;
  customer: { customerName: string };
  items: DNItem[];
}

type StatusFilter = "all" | "Draft" | "Submitted" | "Cancelled";
type ViewMode = "list" | "calendar";

export default function DeliveryNotesPage() {
  const [rows, setRows] = useState<DN[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [view, setView] = useState<ViewMode>("list");

  async function load() {
    setLoading(true);
    try {
      setRows(await api.get<DN[]>("/delivery-notes"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  useListPageCommands({
    singular: "Delivery Note",
    plural: "Delivery Notes",
    newHref: "/stock/delivery-notes/new",
    refresh: load,
  });
  useRealtimeList("delivery-note", load);

  const tourSteps: TourStep[] = [
    { target: "[data-tour=stock-delivery-notes-v1-header]", title: "Delivery Notes", body: "This is where you manage delivery notes. Filter by status, search by name, and drill into any row for details.", placement: "bottom" },
    { target: "[data-tour=stock-delivery-notes-v1-new]", title: "Create a new delivery note", body: "Click here to add your first delivery note. The form captures all the required fields and lets you save as draft or submit immediately.", placement: "bottom" },
    { target: "[data-tour=stock-delivery-notes-v1-filter]", title: "Save a filtered view", body: "Narrow down with the filters, then use the Views menu to save and name the filter set so it's one click next time.", placement: "bottom" },
  ];

  async function submit(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await api.post(`/delivery-notes/${id}/submit`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submit failed");
    }
  }
  async function cancel(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await api.post(`/delivery-notes/${id}/cancel`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cancel failed");
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();

    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (q && !`${r.name} ${r.customer.customerName}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, search, statusFilter]);

  const bulk = useBulkSelect(filtered);
  const bulkActions: BulkAction<DN>[] = standardBulkActions<DN>({
    base: "/delivery-notes",
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

  const columns: Column<DN>[] = [
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
      header: "Delivery Note",
      cell: (r) => (
        <a
          href={`/stock/delivery-notes/${r.id}`}
          className="font-mono text-sm text-brand-600 hover:text-brand-700"
          onClick={(e) => e.stopPropagation()}
        >
          {r.name}
        </a>
      ),
    },
    {
      header: "Customer",
      cell: (r) => <span className="font-medium text-ink">{r.customer.customerName}</span>,
    },
    {
      header: "Date",
      cell: (r) => <span className="text-ink-soft">{dateShort(r.postingDate)}</span>,
    },
    {
      header: "Items",
      cell: (r) => (
        <span className="text-xs text-ink-muted">
          {r.items
            .map((i) => `${i.item.itemCode} × ${Number(i.qty)} from ${i.warehouse.warehouseName}`)
            .join(", ")}
        </span>
      ),
    },
    {
      header: "Status",
      cell: (r) => <StatusBadge status={r.status} />,
    },
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
      <Tour id="stock-web.delivery-notes.v1" steps={tourSteps} />
      <div data-tour="stock-delivery-notes-v1-header">
      <PageHeader
        title="Delivery Notes"
        subtitle={`${rows.length} delivery note${rows.length === 1 ? "" : "s"}`}
        actions={
          <a href="/stock/delivery-notes/new" className="btn-brand" data-tour="stock-delivery-notes-v1-new">+ New delivery note</a>
        }
      />
      </div>

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}

      <div className="space-y-4">
        <div data-tour="stock-delivery-notes-v1-filter">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search DN # or customer…" }}
          filters={
            view === "list" ? (
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
            ) : null
          }
          actions={
            <>
              <SavedViewsControls
                listKey="stock-web:delivery-notes"
                current={{ search, statusFilter }}
                onApply={(f) => { setSearch(f.search); setStatusFilter(f.statusFilter); }}
              />
              <Segmented<ViewMode>
                value={view}
                onChange={setView}
                options={[
                  { value: "list", label: "List" },
                  { value: "calendar", label: "Calendar" },
                ]}
              />
            </>
          }
        />
        </div>
        <BulkActionBar
          count={bulk.selectedRows.length}
          selected={bulk.selectedRows}
          actions={bulkActions}
          onClear={bulk.clear}
        />
        {view === "calendar" ? (
          <CalendarView<DN>
            rows={filtered}
            getStart={(r) => r.postingDate}
            rowKey={(r) => r.id}
            chipAccent={(r) =>
              r.status === "Draft"
                ? "bg-ink-muted/60"
                : r.status === "Cancelled"
                  ? "bg-red-500"
                  : "bg-brand-500"
            }
            renderChip={(r) => `${r.name} · ${r.customer.customerName}`}
            onRowClick={(r) =>
              (window.location.href = `/stock/delivery-notes/${r.id}`)
            }
            emptyMessage="No deliveries scheduled this month."
          />
        ) : (
          <DataTable
            columns={columns}
            rows={filtered}
            rowKey={(r) => r.id}
            onRowClick={(r) => (window.location.href = `/stock/delivery-notes/${r.id}`)}
            loading={loading}
            empty={{
              icon: Icon.box,
              title: search || statusFilter !== "all" ? "No matching delivery notes" : "No delivery notes yet",
              description: search || statusFilter !== "all"
                ? "Try changing your search or filter."
                : "Create your first delivery note to ship stock.",
              action: !search && statusFilter === "all" && (
                <a href="/stock/delivery-notes/new" className="btn-brand">+ New delivery note</a>
              ),
            }}
          />
        )}
      </div>
    </>
  );
}
