"use client";

import { useEffect, useMemo, useState } from "react";
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

interface Advance {
  id: string;
  name: string;
  postingDate: string;
  purpose: string;
  advanceAmount: string;
  paidAmount: string;
  status: string;
  modeOfPayment: string;
  employee: { employeeCode: string; employeeName: string };
}

type StatusFilter = "all" | "Draft" | "Approved" | "Paid" | "Cancelled";

export default function EmployeeAdvancesPage() {
  const [rows, setRows] = useState<Advance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        setRows(await api.get<Advance[]>("/employee-advances"));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (q && !`${r.name} ${r.employee.employeeName} ${r.employee.employeeCode} ${r.purpose}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, search, statusFilter]);

  const counts = useMemo(() => ({
    all:       rows.length,
    Draft:     rows.filter((r) => r.status === "Draft").length,
    Approved:  rows.filter((r) => r.status === "Approved").length,
    Paid:      rows.filter((r) => r.status === "Paid").length,
    Cancelled: rows.filter((r) => r.status === "Cancelled").length,
  }), [rows]);

  const totalOutstanding = useMemo(
    () => rows
      .filter((r) => r.status === "Approved")
      .reduce((s, r) => s + Number(r.advanceAmount ?? 0), 0),
    [rows],
  );

  const columns: Column<Advance>[] = [
    {
      header: "Name",
      cell: (r) => (
        <a
          href={`/hr/employee-advances/${r.id}`}
          className="font-mono text-sm text-brand-600 hover:text-brand-700"
          onClick={(e) => e.stopPropagation()}
        >
          {r.name}
        </a>
      ),
    },
    { header: "Date", cell: (r) => <span className="text-ink-soft">{dateShort(r.postingDate)}</span> },
    {
      header: "Employee",
      cell: (r) => (
        <div>
          <div className="font-medium text-ink">{r.employee.employeeName}</div>
          <div className="text-xs text-ink-muted font-mono">{r.employee.employeeCode}</div>
        </div>
      ),
    },
    { header: "Purpose", cell: (r) => <span className="text-ink-soft">{r.purpose}</span> },
    {
      header: "Amount",
      align: "right",
      cell: (r) => <span className="tabular-nums font-medium text-ink">{money(Number(r.advanceAmount))}</span>,
    },
    { header: "Mode",   cell: (r) => <span className="text-ink-soft">{r.modeOfPayment}</span> },
    { header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <>
      <PageHeader
        title="Employee Advances"
        subtitle={
          totalOutstanding > 0
            ? `${money(totalOutstanding)} approved and awaiting payout`
            : `${rows.length} advance${rows.length === 1 ? "" : "s"}`
        }
        actions={<a href="/hr/employee-advances/new" className="btn-brand">+ New advance</a>}
      />

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}

      <div className="space-y-4">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search employee or purpose…" }}
          filters={
            <Segmented
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: "all",       label: "All",       count: counts.all },
                { value: "Draft",     label: "Draft",     count: counts.Draft },
                { value: "Approved",  label: "Approved",  count: counts.Approved },
                { value: "Paid",      label: "Paid",      count: counts.Paid },
                { value: "Cancelled", label: "Cancelled", count: counts.Cancelled },
              ]}
            />
          }
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.id}
          onRowClick={(r) => (window.location.href = `/hr/employee-advances/${r.id}`)}
          loading={loading}
          empty={{
            icon: Icon.cash,
            title: search || statusFilter !== "all" ? "No matching advances" : "No advances yet",
            description: search || statusFilter !== "all"
              ? "Try changing your search or filter."
              : "Record an advance to track employee prepayments.",
            action: !search && statusFilter === "all" && (
              <a href="/hr/employee-advances/new" className="btn-brand">+ New advance</a>
            ),
          }}
        />
      </div>
    </>
  );
}
