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

interface PaymentRef {
  id: string;
  referenceDoctype: string;
  referenceId: string;
  allocatedAmount: string;
}
interface Payment {
  id: string;
  name: string;
  postingDate: string;
  paymentType: string;
  partyType: string;
  partyId: string;
  paidAmount: string;
  currency: string;
  modeOfPayment: string;
  status: string;
  references: PaymentRef[];
}

type StatusFilter = "all" | "Draft" | "Submitted" | "Cancelled";

export default function PaymentsPage() {
  const [rows, setRows] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const { qs } = useCompanyScope();

  async function load() {
    setLoading(true);
    try {
      setRows(await api.get<Payment[]>(`/payment-entries${qs}`));
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
    singular: "Payment",
    plural: "Payments",
    newHref: "/accounting/payments/new",
    refresh: load,
  });
  useRealtimeList("payment", load);

  const tourSteps: TourStep[] = [
    { target: "[data-tour=accounting-payments-v1-header]", title: "Payments", body: "This is where you manage payments. Filter by status, search by name, and drill into any row for details.", placement: "bottom" },
    { target: "[data-tour=accounting-payments-v1-new]", title: "Create a new payment", body: "Click here to add your first payment. The form captures all the required fields and lets you save as draft or submit immediately.", placement: "bottom" },
    { target: "[data-tour=accounting-payments-v1-filter]", title: "Save a filtered view", body: "Narrow down with the filters, then use the Views menu to save and name the filter set so it's one click next time.", placement: "bottom" },
  ];

  async function submit(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await api.post(`/payment-entries/${id}/submit`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submit failed");
    }
  }
  async function cancel(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await api.post(`/payment-entries/${id}/cancel`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cancel failed");
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (q && !`${r.name} ${r.modeOfPayment} ${r.partyType}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, search, statusFilter]);

  const bulk = useBulkSelect(filtered);
  const bulkActions: BulkAction<Payment>[] = standardBulkActions<Payment>({
    base: "/payments",
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

  const totalSubmitted = useMemo(
    () => rows
      .filter((r) => r.status === "Submitted")
      .reduce((s, r) => s + Number(r.paidAmount ?? 0), 0),
    [rows],
  );

  const columns: Column<Payment>[] = [
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
      header: "Payment",
      cell: (p) => (
        <a
          href={`/accounting/payments/${p.id}`}
          className="font-mono text-sm text-brand-600 hover:text-brand-700"
          onClick={(e) => e.stopPropagation()}
        >
          {p.name}
        </a>
      ),
    },
    { header: "Date", cell: (p) => <span className="text-ink-soft">{dateShort(p.postingDate)}</span> },
    {
      header: "Type",
      cell: (p) => (
        <span className="text-ink">
          {p.paymentType}
          <span className="ms-1 text-xs text-ink-muted">· {p.partyType}</span>
        </span>
      ),
    },
    { header: "Mode", cell: (p) => <span className="text-ink-soft">{p.modeOfPayment}</span> },
    {
      header: "Amount",
      align: "right",
      cell: (p) => (
        <span className="tabular-nums font-medium text-ink">
          {money(Number(p.paidAmount), p.currency ?? "INR")}
        </span>
      ),
    },
    {
      header: "Allocated",
      cell: (p) => (
        <span className="text-xs text-ink-soft">
          {p.references.length === 0
            ? "—"
            : `${p.references.length} invoice${p.references.length > 1 ? "s" : ""}`}
        </span>
      ),
    },
    { header: "Status", cell: (p) => <StatusBadge status={p.status} /> },
    {
      header: "",
      align: "right",
      cell: (p) => (
        <div className="flex items-center justify-end gap-2">
          {p.status === "Draft" && (
            <button onClick={(e) => submit(p.id, e)} className="btn-ghost btn-sm">Submit</button>
          )}
          {p.status !== "Cancelled" && (
            <button onClick={(e) => cancel(p.id, e)} className="btn-ghost btn-sm text-red-600">Cancel</button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <Tour id="accounting-web.payments.v1" steps={tourSteps} />
      <div data-tour="accounting-payments-v1-header">
      <PageHeader
        title="Payments"
        subtitle={
          totalSubmitted > 0
            ? `${money(totalSubmitted)} received across ${counts.Submitted} submitted payment${counts.Submitted === 1 ? "" : "s"}`
            : `${rows.length} payment${rows.length === 1 ? "" : "s"}`
        }
        actions={<a href="/accounting/payments/new" className="btn-brand" data-tour="accounting-payments-v1-new">+ New payment</a>}
      />
      </div>

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}

      <div className="space-y-4">
        <div data-tour="accounting-payments-v1-filter">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search payment # or mode…" }}
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
        actions={<SavedViewsControls listKey="accounting-web:payments" current={{ search, statusFilter }} onApply={(f) => { setSearch(f.search); setStatusFilter(f.statusFilter); }} />}
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
          onRowClick={(r) => (window.location.href = `/accounting/payments/${r.id}`)}
          loading={loading}
          empty={{
            icon: Icon.cash,
            title: search || statusFilter !== "all" ? "No matching payments" : "No payments yet",
            description: search || statusFilter !== "all"
              ? "Try changing your search or filter."
              : "Record your first payment to settle invoices.",
            action: !search && statusFilter === "all" && (
              <a href="/accounting/payments/new" className="btn-brand">+ New payment</a>
            ),
          }}
        />
      </div>
    </>
  );
}
