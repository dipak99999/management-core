"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
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
import { CalendarView } from "../../components/calendar";
import { useCompanyScope } from "../../components/company-scope";
import {
  SavedViewsMenu,
  Tour,
  useListPageCommands,
  useOptionalUIBackends,
  useRealtimeList,
  useSavedViews,
  type TourStep,
} from "@lumaara/web-ui";

interface SIRow {
  id: string;
  name: string;
  postingDate: string;
  dueDate: string | null;
  status: string;
  grandTotal: string;
  currency?: string;
  customer: { customerName: string };
}

type StatusFilter = "all" | "Draft" | "Submitted" | "Paid";
type ViewMode = "list" | "calendar";

// Colour by lifecycle so a glance at the calendar tells the AR team where
// their attention should go: red for unpaid past-due (Submitted with a
// dueDate before today), amber for Submitted, green for Paid, grey Draft.
function invoiceAccent(r: SIRow): string {
  if (r.status === "Draft") return "bg-ink-muted/60";
  if (r.status === "Paid") return "bg-green-500";
  const due = r.dueDate ? new Date(r.dueDate) : null;
  if (due && due < new Date()) return "bg-red-500";
  return "bg-amber-500";
}

// URL filters land here when a dashboard tile deep-links in. Supports:
//   ?status=Submitted | Draft | Paid
//   ?overdue=1        — Submitted invoices with dueDate < today
function parseStatus(v: string | null): StatusFilter {
  return v === "Draft" || v === "Submitted" || v === "Paid" ? v : "all";
}

export default function SalesInvoicesPage() {
  const params = useSearchParams();
  const initialStatus = parseStatus(params?.get("status") ?? null);
  const overdueOnly = params?.get("overdue") === "1";

  const [rows, setRows] = useState<SIRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(
    overdueOnly ? "Submitted" : initialStatus,
  );
  const [view, setView] = useState<ViewMode>("list");
  // Row selection for bulk actions. Cleared when the row set or filter changes.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const { qs } = useCompanyScope();

  async function load() {
    setLoading(true);
    try {
      setRows(await api.get<SIRow[]>(`/sales-invoices${qs}`));
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
    singular: "Invoice",
    plural: "Invoices",
    group: "Sales Invoices",
    newHref: "/accounting/sales-invoices/new",
    refresh: load,
  });

  useRealtimeList("sales-invoice", load);

  // Server-backed saved views. Falls back to localStorage without a session.
  const backends = useOptionalUIBackends();
  const views = useSavedViews<{ search: string; statusFilter: StatusFilter }>(
    "accounting-web:sales-invoices",
    backends?.views,
  );

  const tourSteps: TourStep[] = [
    {
      target: "[data-tour=si-header]",
      title: "Sales invoices",
      body: "Draft invoices and submit them to post to the GL. From here you can filter by status, drill into any invoice, or create a new one.",
      placement: "bottom",
    },
    {
      target: "[data-tour=si-new]",
      title: "Create your first invoice",
      body: "The new-invoice form supports multi-line items, taxes, discounts, and advances. Save as draft to keep editing, or submit to post immediately.",
      placement: "bottom",
    },
    {
      target: "[data-tour=si-filter]",
      title: "Save a workbench view",
      body: "Filter by status (Overdue, Draft, Paid) or date range. Save your view so your next visit lands on the same working set — views persist to your account.",
      placement: "bottom",
    },
  ];

  async function submit(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    await api.post(`/sales-invoices/${id}/submit`, {});
    await load();
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const now = Date.now();
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (overdueOnly) {
        if (r.status !== "Submitted") return false;
        if (!r.dueDate || new Date(r.dueDate).getTime() >= now) return false;
      }
      if (q && !`${r.name} ${r.customer.customerName}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, search, statusFilter, overdueOnly]);

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

  const allSelected = filtered.length > 0 && filtered.every((r) => selectedIds.has(r.id));
  const someSelected = selectedIds.size > 0;
  function toggleOne(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  }
  function toggleAll(checked: boolean) {
    if (checked) setSelectedIds(new Set(filtered.map((r) => r.id)));
    else setSelectedIds(new Set());
  }
  async function bulkSubmit() {
    const drafts = filtered.filter((r) => selectedIds.has(r.id) && r.status === "Draft");
    if (drafts.length === 0) { setError("No draft invoices in selection."); return; }
    if (!confirm(`Submit ${drafts.length} draft invoice${drafts.length === 1 ? "" : "s"}? Posts GL entries.`)) return;
    setBulkBusy(true);
    const failures: string[] = [];
    try {
      for (const r of drafts) {
        try { await api.post(`/sales-invoices/${r.id}/submit`, {}); }
        catch { failures.push(r.name); }
      }
      setSelectedIds(new Set());
      await load();
    } finally { setBulkBusy(false); }
    if (failures.length > 0) {
      setError(
        `Submitted ${drafts.length - failures.length} / ${drafts.length}. Could not submit: ${failures.slice(0, 3).join(", ")}${failures.length > 3 ? `, +${failures.length - 3} more` : ""}.`,
      );
    }
  }

  const columns: Column<SIRow>[] = [
    {
      header: (
        <input
          type="checkbox"
          aria-label="Select all"
          checked={allSelected}
          onChange={(e) => toggleAll(e.target.checked)}
          className="h-4 w-4 rounded border-ink/20 accent-ink"
        />
      ),
      width: "36px",
      sortable: false,
      cell: (r) => (
        <input
          type="checkbox"
          aria-label={`Select ${r.name}`}
          checked={selectedIds.has(r.id)}
          onChange={(e) => toggleOne(r.id, e.target.checked)}
          onClick={(e) => e.stopPropagation()}
          className="h-4 w-4 rounded border-ink/20 accent-ink"
        />
      ),
    },
    {
      header: "Invoice",
      cell: (r) => (
        <a
          href={`/accounting/sales-invoices/${r.id}`}
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
          <button
            onClick={(e) => submit(r.id, e)}
            className="btn-ghost btn-sm"
          >
            Submit
          </button>
        ) : null,
    },
  ];

  return (
    <>
      <Tour id="accounting-web.sales-invoices.v1" steps={tourSteps} />
      <div data-tour="si-header">
      <PageHeader
        icon={Icon.invoice}
        title="Invoices"
        subtitle={
          totalOutstanding > 0
            ? `${money(totalOutstanding)} outstanding across ${counts.Submitted} submitted invoice${counts.Submitted === 1 ? "" : "s"} — advance, final and credit-note invoices issued against orders.`
            : "Advance, final, and credit-note invoices issued against orders."
        }
        actions={
          <a href="/accounting/sales-invoices/new" className="btn-primary" data-tour="si-new">
            + New invoice
          </a>
        }
      />
      </div>

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}

      {someSelected && (
        <div
          className="fixed bottom-6 start-1/2 -translate-x-1/2 z-30 bg-ink text-white rounded-pill shadow-raised px-4 py-2.5 flex items-center gap-3"
          role="toolbar"
          aria-label="Bulk invoice actions"
        >
          <span className="text-xs font-medium">
            {selectedIds.size} selected
          </span>
          <span className="h-4 w-px bg-white/20" />
          <button
            type="button"
            onClick={bulkSubmit}
            disabled={bulkBusy}
            className="text-xs font-semibold hover:text-gold-300 disabled:opacity-50"
          >
            {bulkBusy ? "Submitting…" : "Submit drafts"}
          </button>
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            className="text-xs text-white/70 hover:text-white"
          >
            Clear
          </button>
        </div>
      )}

      {overdueOnly && (
        <div className="mb-4 inline-flex items-center gap-2 rounded-pill border border-amber-300 bg-amber-50 text-amber-900 text-xs px-3 py-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
          Showing overdue submitted invoices only
          <a href="/accounting/sales-invoices" className="underline underline-offset-2 hover:no-underline">
            clear
          </a>
        </div>
      )}

      <div className="space-y-4">
        <div data-tour="si-filter">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search invoice # or customer…" }}
          filters={
            view === "list" ? (
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
            ) : null
          }
          actions={
            <>
              <SavedViewsMenu
                controller={views}
                currentFilters={{ search, statusFilter }}
                onApply={(f) => {
                  setSearch(f.search);
                  setStatusFilter(f.statusFilter);
                }}
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
        {view === "calendar" ? (
          <CalendarView<SIRow>
            rows={filtered}
            // Use dueDate when set (that's the AR-relevant date); fall back
            // to postingDate for Drafts/no-due invoices so they still show.
            getStart={(r) => r.dueDate ?? r.postingDate}
            rowKey={(r) => r.id}
            chipAccent={invoiceAccent}
            renderChip={(r) => `${r.name} · ${money(Number(r.grandTotal))}`}
            onRowClick={(r) =>
              (window.location.href = `/accounting/sales-invoices/${r.id}`)
            }
            emptyMessage="No invoices due this month."
          />
        ) : (
          <DataTable
            columns={columns}
            rows={filtered}
            rowKey={(r) => r.id}
            onRowClick={(r) => (window.location.href = `/accounting/sales-invoices/${r.id}`)}
            loading={loading}
            empty={{
              icon: Icon.invoice,
              title: search || statusFilter !== "all" ? "No matching invoices" : "No invoices yet",
              description: search || statusFilter !== "all"
                ? "Try changing your search or filter."
                : "Create your first invoice to start getting paid.",
              action: !search && statusFilter === "all" && (
                <a href="/accounting/sales-invoices/new" className="btn-brand">+ New invoice</a>
              ),
            }}
          />
        )}
      </div>
    </>
  );
}
