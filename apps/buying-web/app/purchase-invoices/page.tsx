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
  money,
  type Column,
} from "../../components/ui";
import { Icon } from "../../components/app-shell";
import { useCompanyScope } from "../../components/company-scope";

interface PIRow {
  id: string;
  name: string;
  postingDate: string;
  status: string;
  grandTotal: string;
  currency?: string;
  supplierInvoiceNo: string | null;
  supplier: { supplierName: string };
}

type StatusFilter = "all" | "Draft" | "Submitted" | "Paid";

export default function PurchaseInvoicesPage() {
  const [rows, setRows] = useState<PIRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const { qs } = useCompanyScope();

  async function load() {
    setLoading(true);
    try {
      setRows(await api.get<PIRow[]>(`/purchase-invoices${qs}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qs]);

  useListPageCommands({
    singular: "Purchase Invoice",
    plural: "Purchase Invoices",
    newHref: "/buying/purchase-invoices/new",
    refresh: load,
  });
  useRealtimeList("purchase-invoice", load);

  const tourSteps: TourStep[] = [
    { target: "[data-tour=buying-purchase-invoices-v1-header]", title: "Purchase Invoices", body: "This is where you manage purchase invoices. Filter by status, search by name, and drill into any row for details.", placement: "bottom" },
    { target: "[data-tour=buying-purchase-invoices-v1-new]", title: "Create a new purchase invoice", body: "Click here to add your first purchase invoice. The form captures all the required fields and lets you save as draft or submit immediately.", placement: "bottom" },
    { target: "[data-tour=buying-purchase-invoices-v1-filter]", title: "Save a filtered view", body: "Narrow down with the filters, then use the Views menu to save and name the filter set so it's one click next time.", placement: "bottom" },
  ];

  async function submit(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    await api.post(`/purchase-invoices/${id}/submit`, {});
    await load();
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (
        q &&
        !`${r.name} ${r.supplier.supplierName} ${r.supplierInvoiceNo ?? ""}`
          .toLowerCase()
          .includes(q)
      )
        return false;
      return true;
    });
  }, [rows, search, statusFilter]);

  const bulk = useBulkSelect(filtered);
  const bulkActions: BulkAction<PIRow>[] = standardBulkActions<PIRow>({
    base: "/purchase-invoices",
    api,
    onDone: load,
    clear: bulk.clear,
  });

  const counts = useMemo(() => ({
    all:       rows.length,
    Draft:     rows.filter((r) => r.status === "Draft").length,
    Submitted: rows.filter((r) => r.status === "Submitted").length,
    Paid:      rows.filter((r) => r.status === "Paid").length,
  }), [rows]);

  const totalOutstanding = useMemo(
    () => rows
      .filter((r) => r.status === "Submitted")
      .reduce((s, r) => s + Number(r.grandTotal ?? 0), 0),
    [rows],
  );

  const columns: Column<PIRow>[] = [
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
      header: "Invoice",
      cell: (r) => (
        <a
          href={`/buying/purchase-invoices/${r.id}`}
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
      header: "Supplier Bill #",
      cell: (r) => <span className="font-mono text-xs text-ink-soft">{r.supplierInvoiceNo ?? "—"}</span>,
    },
    {
      header: "Date",
      cell: (r) => <span className="text-ink-soft">{dateShort(r.postingDate)}</span>,
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
      <Tour id="buying-web.purchase-invoices.v1" steps={tourSteps} />
      <div data-tour="buying-purchase-invoices-v1-header">
      <PageHeader
        title="Purchase Invoices"
        subtitle={
          totalOutstanding > 0
            ? `${money(totalOutstanding)} outstanding across ${counts.Submitted} submitted invoice${counts.Submitted === 1 ? "" : "s"}`
            : `${rows.length} invoice${rows.length === 1 ? "" : "s"}`
        }
        actions={
          <a href="/buying/purchase-invoices/new" className="btn-brand" data-tour="buying-purchase-invoices-v1-new">+ New invoice</a>
        }
      />
      </div>

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}

      <div className="space-y-4">
        <div data-tour="buying-purchase-invoices-v1-filter">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search invoice #, supplier, bill #…" }}
          filters={
            <Segmented
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: "all",       label: "All",       count: counts.all },
                { value: "Draft",     label: "Draft",     count: counts.Draft },
                { value: "Submitted", label: "Submitted", count: counts.Submitted },
                { value: "Paid",      label: "Paid",      count: counts.Paid },
              ]}
            />
          }
          actions={<SavedViewsControls listKey="buying-web:purchase-invoices" current={{ search, statusFilter }} onApply={(f) => { setSearch(f.search); setStatusFilter(f.statusFilter); }} />}
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
          onRowClick={(r) => (window.location.href = `/buying/purchase-invoices/${r.id}`)}
          loading={loading}
          empty={{
            icon: Icon.invoice,
            title: search || statusFilter !== "all" ? "No matching invoices" : "No invoices yet",
            description: search || statusFilter !== "all"
              ? "Try changing your search or filter."
              : "Record your first supplier invoice.",
            action: !search && statusFilter === "all" && (
              <a href="/buying/purchase-invoices/new" className="btn-brand">+ New invoice</a>
            ),
          }}
        />
      </div>
    </>
  );
}
