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

interface QItem {
  id: string;
  qty: string;
  rate: string;
  amount: string;
  item: { itemCode: string; itemName: string };
}
interface Q {
  id: string;
  name: string;
  partyType: string;
  quotationDate: string;
  validTill: string | null;
  grandTotal: string;
  status: string;
  lead: { name: string; leadName: string } | null;
  customer: { customerName: string } | null;
  items: QItem[];
}

type StatusFilter = "all" | "Draft" | "Submitted" | "Ordered" | "Cancelled" | "Lost";

export default function QuotationsPage() {
  const [rows, setRows] = useState<Q[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  async function load() {
    setLoading(true);
    try {
      setRows(await api.get<Q[]>("/quotations"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  useListPageCommands({
    singular: "Quotation",
    plural: "Quotations",
    newHref: "/crm/quotations/new",
    refresh: load,
  });
  useRealtimeList("quotation", load);

  const tourSteps: TourStep[] = [
    { target: "[data-tour=crm-quotations-v1-header]", title: "Quotations", body: "This is where you manage quotations. Filter by status, search by name, and drill into any row for details.", placement: "bottom" },
    { target: "[data-tour=crm-quotations-v1-new]", title: "Create a new quotation", body: "Click here to add your first quotation. The form captures all the required fields and lets you save as draft or submit immediately.", placement: "bottom" },
    { target: "[data-tour=crm-quotations-v1-filter]", title: "Save a filtered view", body: "Narrow down with the filters, then use the Views menu to save and name the filter set so it's one click next time.", placement: "bottom" },
  ];

  // Track which row has an in-flight action so we can disable buttons per-row.
  const [busyId, setBusyId] = useState<string | null>(null);

  async function submit(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (busyId) return;
    setBusyId(id);
    try {
      await api.post(`/quotations/${id}/submit`, {});
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
    if (!confirm("Cancel this quotation? This will move it out of the active pipeline.")) return;
    setBusyId(id);
    try {
      await api.post(`/quotations/${id}/cancel`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cancel failed");
    } finally {
      setBusyId(null);
    }
  }
  async function convert(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (busyId) return;
    if (!confirm("Create a Sales Order from this quotation?")) return;
    setBusyId(id);
    try {
      await api.post(`/quotations/${id}/convert-to-sales-order`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Convert failed");
    } finally {
      setBusyId(null);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();

    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      const label =
        r.customer?.customerName ?? (r.lead ? `${r.lead.name} ${r.lead.leadName}` : "");
      if (q && !`${r.name} ${label}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, search, statusFilter]);

  const bulk = useBulkSelect(filtered);
  const bulkActions: BulkAction<Q>[] = standardBulkActions<Q>({
    base: "/quotations",
    api,
    onDone: load,
    clear: bulk.clear,
  });

  const counts = useMemo(
    () => ({
      all: rows.length,
      Draft: rows.filter((r) => r.status === "Draft").length,
      Submitted: rows.filter((r) => r.status === "Submitted").length,
      Ordered: rows.filter((r) => r.status === "Ordered").length,
      Cancelled: rows.filter((r) => r.status === "Cancelled").length,
      Lost: rows.filter((r) => r.status === "Lost").length,
    }),
    [rows],
  );

  const openValue = useMemo(
    () =>
      rows
        .filter((r) => r.status === "Submitted")
        .reduce((s, r) => s + Number(r.grandTotal ?? 0), 0),
    [rows],
  );

  const columns: Column<Q>[] = [
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
      header: "Quotation",
      cell: (q) => (
        <a
          href={`/crm/quotations/${q.id}`}
          className="font-mono text-sm text-brand-600 hover:text-brand-700"
          onClick={(e) => e.stopPropagation()}
        >
          {q.name}
        </a>
      ),
    },
    {
      header: "Party",
      cell: (q) => (
        <span className="font-medium text-ink">
          {q.customer?.customerName ??
            (q.lead ? `${q.lead.name} — ${q.lead.leadName}` : "—")}
        </span>
      ),
    },
    {
      header: "Date",
      cell: (q) => <span className="text-ink-soft">{dateShort(q.quotationDate)}</span>,
    },
    {
      header: "Grand total",
      align: "right",
      cell: (q) => (
        <span className="tabular-nums font-medium text-ink">
          {money(Number(q.grandTotal))}
        </span>
      ),
    },
    {
      header: "Status",
      cell: (q) => <StatusBadge status={q.status} />,
    },
    {
      header: "",
      align: "right",
      cell: (q) => (
        <div className="flex justify-end gap-2">
          {q.status === "Draft" && (
            <button
              onClick={(e) => submit(q.id, e)}
              disabled={busyId === q.id}
              className="btn-ghost btn-sm disabled:opacity-50"
            >
              {busyId === q.id ? "…" : "Submit"}
            </button>
          )}
          {q.status === "Submitted" && q.customer && (
            <button
              onClick={(e) => convert(q.id, e)}
              disabled={busyId === q.id}
              className="btn-ghost btn-sm disabled:opacity-50"
            >
              {busyId === q.id ? "…" : "→ Sales Order"}
            </button>
          )}
          {q.status !== "Cancelled" && q.status !== "Ordered" && (
            <button
              onClick={(e) => cancel(q.id, e)}
              disabled={busyId === q.id}
              className="btn-ghost btn-sm text-red-600 hover:text-red-700 disabled:opacity-50"
            >
              {busyId === q.id ? "…" : "Cancel"}
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <Tour id="crm-web.quotations.v1" steps={tourSteps} />
      <div data-tour="crm-quotations-v1-header">
      <PageHeader
        icon={Icon.invoice}
        title="Quotations"
        subtitle={
          openValue > 0
            ? `${money(openValue)} open across ${counts.Submitted} submitted quote${counts.Submitted === 1 ? "" : "s"} — build, approve, and send. Click any row to drill in.`
            : "Build, approve, and send quotations. Click any row to drill in."
        }
        actions={
          <a href="/crm/quotations/new" className="btn-primary" data-tour="crm-quotations-v1-new">
            + New quote
          </a>
        }
      />
      </div>

      {error && (
        <div className="mb-4">
          <Toast kind="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      <div className="space-y-4">
        <div data-tour="crm-quotations-v1-filter">
        <FilterBar
          search={{
            value: search,
            onChange: setSearch,
            placeholder: "Search quotation # or party…",
          }}
          filters={
            <Segmented
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: "all", label: "All", count: counts.all },
                { value: "Draft", label: "Draft", count: counts.Draft },
                { value: "Submitted", label: "Submitted", count: counts.Submitted },
                { value: "Ordered", label: "Ordered", count: counts.Ordered },
                { value: "Cancelled", label: "Cancelled", count: counts.Cancelled },
                { value: "Lost", label: "Lost", count: counts.Lost },
              ]}
            />
          }
        actions={<SavedViewsControls listKey="crm-web:quotations" current={{ search, statusFilter }} onApply={(f) => { setSearch(f.search); setStatusFilter(f.statusFilter); }} />}
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
          rowKey={(q) => q.id}
          onRowClick={(q) => (window.location.href = `/crm/quotations/${q.id}`)}
          loading={loading}
          empty={{
            icon: Icon.invoice,
            title:
              search || statusFilter !== "all" ? "No matching quotations" : "No quotations yet",
            description:
              search || statusFilter !== "all"
                ? "Try changing your search or filter."
                : "Send your first quotation to move deals forward.",
            action: !search && statusFilter === "all" && (
              <a href="/crm/quotations/new" className="btn-brand">
                + New quotation
              </a>
            ),
          }}
        />
      </div>
    </>
  );
}
