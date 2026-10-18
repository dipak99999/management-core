"use client";

import { useEffect, useMemo, useState } from "react";
import { useListPageCommands, BulkActionBar, SelectCheckbox, standardBulkActions, useBulkSelect, type BulkAction, Tour, type TourStep, useRealtimeList, SavedViewsControls } from "@lumaara/web-ui";
import { showToast } from "../../lib/toast";
import { api } from "../../lib/api";
import {
  Button,
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

interface SS {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  grossPay: string;
  totalDeduction: string;
  netPay: string;
  status: string;
  employee: { employeeCode: string; employeeName: string };
}

type StatusFilter = "all" | "Draft" | "Submitted" | "Paid" | "Cancelled";

function firstOfMonth(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}
function lastOfMonth(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
}

export default function SalarySlipsPage() {
  const [rows, setRows] = useState<SS[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  async function load() {
    setLoading(true);
    try {
      setRows(await api.get<SS[]>("/salary-slips"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  useListPageCommands({
    singular: "Salary Slip",
    plural: "Salary Slips",
    newHref: "/hr/salary-slips/new",
    refresh: load,
  });
  useRealtimeList("salary-slip", load);

  const tourSteps: TourStep[] = [
    { target: "[data-tour=hr-salary-slips-v1-header]", title: "Salary Slips", body: "This is where you manage salary slips. Filter by status, search by name, and drill into any row for details.", placement: "bottom" },
    { target: "[data-tour=hr-salary-slips-v1-new]", title: "Create a new salary slip", body: "Click here to add your first salary slip. The form captures all the required fields and lets you save as draft or submit immediately.", placement: "bottom" },
    { target: "[data-tour=hr-salary-slips-v1-filter]", title: "Save a filtered view", body: "Narrow down with the filters, then use the Views menu to save and name the filter set so it's one click next time.", placement: "bottom" },
  ];

  async function submit(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await api.post(`/salary-slips/${id}/submit`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submit failed");
    }
  }
  async function cancel(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await api.post(`/salary-slips/${id}/cancel`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cancel failed");
    }
  }

  async function bulk() {
    const startDate = prompt("Period start (YYYY-MM-DD)", firstOfMonth());
    if (!startDate) return;
    const endDate = prompt("Period end (YYYY-MM-DD)", lastOfMonth());
    if (!endDate) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{
        created: { name: string; employeeCode: string }[];
        skipped: { employeeCode: string; reason: string }[];
      }>("/salary-slips/bulk-generate", { startDate, endDate });
      showToast(
        `Created ${r.created.length} slip(s). Skipped ${r.skipped.length}${
          r.skipped.length ? ": " + r.skipped.map((s) => `${s.employeeCode} (${s.reason})`).join(", ") : ""
        }.`,
        r.skipped.length > 0 ? "info" : "success",
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bulk generate failed");
    } finally {
      setBusy(false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (q && !`${r.name} ${r.employee.employeeName} ${r.employee.employeeCode}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, search, statusFilter]);

  const selection = useBulkSelect(filtered);
  const bulkActions: BulkAction<SS>[] = standardBulkActions<SS>({
    base: "/salary-slips",
    api,
    onDone: load,
    clear: selection.clear,
  });

  const counts = useMemo(() => ({
    all:       rows.length,
    Draft:     rows.filter((r) => r.status === "Draft").length,
    Submitted: rows.filter((r) => r.status === "Submitted").length,
    Paid:      rows.filter((r) => r.status === "Paid").length,
    Cancelled: rows.filter((r) => r.status === "Cancelled").length,
  }), [rows]);

  const totalNet = useMemo(
    () => rows
      .filter((r) => r.status === "Submitted" || r.status === "Paid")
      .reduce((s, r) => s + Number(r.netPay ?? 0), 0),
    [rows],
  );

  const columns: Column<SS>[] = [
    {
      header: (
        <SelectCheckbox
          checked={selection.allSelected}
          indeterminate={selection.someSelected}
          onChange={selection.toggleAll}
          aria-label="Select all"
        />
      ),
      cell: (r) => (
        <SelectCheckbox
          checked={selection.isSelected(r.id)}
          onChange={() => selection.toggle(r.id)}
          aria-label="Select row"
        />
      ),
    },
    {
      header: "Slip",
      cell: (s) => (
        <a
          href={`/hr/salary-slips/${s.id}`}
          className="font-mono text-sm text-brand-600 hover:text-brand-700"
          onClick={(e) => e.stopPropagation()}
        >
          {s.name}
        </a>
      ),
    },
    {
      header: "Employee",
      cell: (s) => (
        <div>
          <div className="font-medium text-ink">{s.employee.employeeName}</div>
          <div className="text-xs text-ink-muted font-mono">{s.employee.employeeCode}</div>
        </div>
      ),
    },
    {
      header: "Period",
      cell: (s) => (
        <span className="text-ink-soft">
          {dateShort(s.startDate)} → {dateShort(s.endDate)}
        </span>
      ),
    },
    {
      header: "Gross",
      align: "right",
      cell: (s) => <span className="tabular-nums text-ink-soft">{money(Number(s.grossPay))}</span>,
    },
    {
      header: "Deductions",
      align: "right",
      cell: (s) => <span className="tabular-nums text-ink-soft">{money(Number(s.totalDeduction))}</span>,
    },
    {
      header: "Net",
      align: "right",
      cell: (s) => <span className="tabular-nums font-medium text-ink">{money(Number(s.netPay))}</span>,
    },
    { header: "Status", cell: (s) => <StatusBadge status={s.status} /> },
    {
      header: "",
      align: "right",
      cell: (s) => (
        <div className="flex items-center gap-1 justify-end">
          {s.status === "Draft" && (
            <button onClick={(e) => submit(s.id, e)} className="btn-ghost btn-sm">Submit</button>
          )}
          {s.status !== "Cancelled" && (
            <button onClick={(e) => cancel(s.id, e)} className="btn-ghost btn-sm text-red-600">Cancel</button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <Tour id="hr-web.salary-slips.v1" steps={tourSteps} />
      <div data-tour="hr-salary-slips-v1-header">
      <PageHeader
        title="Salary Slips"
        subtitle={
          totalNet > 0
            ? `${money(totalNet)} net across ${counts.Submitted + counts.Paid} slip${counts.Submitted + counts.Paid === 1 ? "" : "s"}`
            : `${rows.length} slip${rows.length === 1 ? "" : "s"}`
        }
        actions={
          <>
            <Button variant="secondary" onClick={bulk} disabled={busy}>
              {busy ? "Generating…" : "Bulk generate"}
            </Button>
            <a href="/hr/salary-slips/new" className="btn-brand" data-tour="hr-salary-slips-v1-new">+ New slip</a>
          </>
        }
      />
      </div>

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}

      <div className="space-y-4">
        <div data-tour="hr-salary-slips-v1-filter">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search slip # or employee…" }}
          filters={
            <Segmented
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: "all",       label: "All",       count: counts.all },
                { value: "Draft",     label: "Draft",     count: counts.Draft },
                { value: "Submitted", label: "Submitted", count: counts.Submitted },
                { value: "Paid",      label: "Paid",      count: counts.Paid },
                { value: "Cancelled", label: "Cancelled", count: counts.Cancelled },
              ]}
            />
          }
          actions={<SavedViewsControls listKey="hr-web:salary-slips" current={{ search, statusFilter }} onApply={(f) => { setSearch(f.search); setStatusFilter(f.statusFilter); }} />}
        />
          </div>
        <BulkActionBar
          count={selection.selectedRows.length}
          selected={selection.selectedRows}
          actions={bulkActions}
          onClear={selection.clear}
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(s) => s.id}
          onRowClick={(s) => (window.location.href = `/hr/salary-slips/${s.id}`)}
          loading={loading}
          empty={{
            icon: Icon.cash,
            title: search || statusFilter !== "all" ? "No matching slips" : "No salary slips yet",
            description: search || statusFilter !== "all"
              ? "Try changing your search or filter."
              : "Create a slip or bulk-generate for a period.",
            action: !search && statusFilter === "all" && (
              <a href="/hr/salary-slips/new" className="btn-brand">+ New slip</a>
            ),
          }}
        />
      </div>
    </>
  );
}
