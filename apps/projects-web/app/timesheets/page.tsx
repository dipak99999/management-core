"use client";

import { useEffect, useMemo, useState } from "react";
import { useListPageCommands, BulkActionBar, SelectCheckbox, standardBulkActions, useBulkSelect, type BulkAction, Tour, type TourStep, SavedViewsControls, useRealtimeList } from "@lumaara/web-ui";
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

interface Timesheet {
  id: string;
  name: string;
  weekStartDate: string;
  totalHours: string;
  totalBillableHours: string;
  totalBillingAmount: string;
  status: string;
  employee: { id: string; employeeCode: string; employeeName: string };
  _count: { lines: number };
}

type StatusFilter = "all" | "Draft" | "Submitted" | "Cancelled";

export default function TimesheetsListPage() {
  const [rows, setRows] = useState<Timesheet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  async function load() {
    setLoading(true);
    try {
      setRows(await api.get<Timesheet[]>("/timesheets"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  useListPageCommands({
    singular: "Timesheet",
    plural: "Timesheets",
    newHref: "/projects/timesheets/new",
    refresh: load,
  });
  useRealtimeList("timesheet", load);
  const tourSteps: TourStep[] = [
    { target: "[data-tour=projects-timesheets-v1-header]", title: "Timesheets", body: "This is where you manage timesheets. Filter by status, search by name, and drill into any row for details.", placement: "bottom" },
    { target: "[data-tour=projects-timesheets-v1-new]", title: "Create a new timesheet", body: "Click here to add your first timesheet. The form captures all the required fields and lets you save as draft or submit immediately.", placement: "bottom" },
    { target: "[data-tour=projects-timesheets-v1-filter]", title: "Save a filtered view", body: "Narrow down with the filters, then use the Views menu to save and name the filter set so it's one click next time.", placement: "bottom" },
  ];

  async function submit(t: Timesheet, e: React.MouseEvent) {
    e.stopPropagation();
    setBusy(true);
    setError(null);
    try {
      await api.post(`/timesheets/${t.id}/submit`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }
  async function cancel(t: Timesheet, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`Cancel ${t.name}? Task hours will be reversed.`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/timesheets/${t.id}/cancel`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();

    return rows.filter((t) => {
      if (statusFilter !== "all" && t.status !== statusFilter) return false;
      if (
        q &&
        !`${t.name} ${t.employee.employeeName} ${t.employee.employeeCode}`
          .toLowerCase()
          .includes(q)
      )
        return false;
      return true;
    });
  }, [rows, search, statusFilter]);

  const bulk = useBulkSelect(filtered);
  const bulkActions: BulkAction<Timesheet>[] = standardBulkActions<Timesheet>({
    base: "/timesheets",
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

  const totalBillable = useMemo(
    () => rows
      .filter((r) => r.status === "Submitted")
      .reduce((s, r) => s + Number(r.totalBillingAmount ?? 0), 0),
    [rows],
  );

  const columns: Column<Timesheet>[] = [
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
      header: "Timesheet",
      cell: (t) => (
        <div onClick={(e) => e.stopPropagation()}>
          <a
            href={`/projects/timesheets/${t.id}`}
            className="font-mono text-sm text-brand-600 hover:text-brand-700"
          >
            {t.name}
          </a>
          <div className="text-xs text-ink-muted">
            {t._count.lines} line{t._count.lines !== 1 ? "s" : ""}
          </div>
        </div>
      ),
    },
    {
      header: "Employee",
      cell: (t) => (
        <div>
          <div className="font-medium text-ink">{t.employee.employeeName}</div>
          <div className="text-xs text-ink-muted font-mono">{t.employee.employeeCode}</div>
        </div>
      ),
    },
    {
      header: "Week",
      cell: (t) => <span className="text-ink-soft">{dateShort(t.weekStartDate)}</span>,
    },
    {
      header: "Total hrs",
      align: "right",
      cell: (t) => <span className="tabular-nums text-ink">{Number(t.totalHours).toFixed(2)}</span>,
    },
    {
      header: "Billable",
      align: "right",
      cell: (t) => (
        <span className="tabular-nums text-ink-soft">{Number(t.totalBillableHours).toFixed(2)}</span>
      ),
    },
    {
      header: "Amount",
      align: "right",
      cell: (t) => (
        <span className="tabular-nums font-medium text-ink">
          {money(Number(t.totalBillingAmount))}
        </span>
      ),
    },
    {
      header: "Status",
      cell: (t) => <StatusBadge status={t.status} />,
    },
    {
      header: "",
      align: "right",
      cell: (t) => (
        <span onClick={(e) => e.stopPropagation()} className="inline-flex gap-1">
          {t.status === "Draft" && (
            <button
              onClick={(e) => submit(t, e)}
              disabled={busy}
              className="btn-ghost btn-sm"
            >
              Submit
            </button>
          )}
          {t.status !== "Cancelled" && (
            <button
              onClick={(e) => cancel(t, e)}
              disabled={busy}
              className="btn-ghost btn-sm text-ink-muted"
            >
              Cancel
            </button>
          )}
        </span>
      ),
    },
  ];

  return (
    <>
      <Tour id="projects-web.timesheets.v1" steps={tourSteps} />
      <div data-tour="projects-timesheets-v1-header">
      <PageHeader
        breadcrumb={[{ label: "Home", href: "/" }, { label: "Timesheets" }]}
        title="Timesheets"
        subtitle={
          totalBillable > 0
            ? `${money(totalBillable)} billable across ${counts.Submitted} submitted timesheet${counts.Submitted === 1 ? "" : "s"}`
            : `${rows.length} timesheet${rows.length === 1 ? "" : "s"}`
        }
        actions={
          <a href="/projects/timesheets/new" className="btn-brand" data-tour="projects-timesheets-v1-new">+ New timesheet</a>
        }
      />
      </div>

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}

      <div className="space-y-4">
        <div data-tour="projects-timesheets-v1-filter">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search timesheet # or employee…" }}
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
          actions={<SavedViewsControls listKey="projects-web:timesheets" current={{ search, statusFilter }} onApply={(fv) => { setSearch(fv.search); setStatusFilter(fv.statusFilter); }} />}
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
          rowKey={(t) => t.id}
          onRowClick={(t) => (window.location.href = `/projects/timesheets/${t.id}`)}
          loading={loading}
          empty={{
            icon: Icon.clock,
            title: search || statusFilter !== "all" ? "No matching timesheets" : "No timesheets yet",
            description: search || statusFilter !== "all"
              ? "Try changing your search or filter."
              : "Log your first week of hours. On submit, per-task hours roll up into Task.actualHours.",
            action: !search && statusFilter === "all" && (
              <a href="/projects/timesheets/new" className="btn-brand">+ New timesheet</a>
            ),
          }}
        />
      </div>
    </>
  );
}
