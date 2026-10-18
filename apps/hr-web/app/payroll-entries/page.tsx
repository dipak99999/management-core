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

interface Entry {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: string;
  slipsCount: number;
  totalGross: string;
  totalNet: string;
  paymentMode: string;
}

type StatusFilter = "all" | "Draft" | "Submitted" | "Cancelled";

export default function PayrollEntriesPage() {
  const [rows, setRows] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        setRows(await api.get<Entry[]>("/payroll-entries"));
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
      if (q && !`${r.name} ${r.paymentMode}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, search, statusFilter]);

  const counts = useMemo(() => ({
    all:       rows.length,
    Draft:     rows.filter((r) => r.status === "Draft").length,
    Submitted: rows.filter((r) => r.status === "Submitted").length,
    Cancelled: rows.filter((r) => r.status === "Cancelled").length,
  }), [rows]);

  const totalSubmittedNet = useMemo(
    () => rows
      .filter((r) => r.status === "Submitted")
      .reduce((s, r) => s + Number(r.totalNet ?? 0), 0),
    [rows],
  );

  const columns: Column<Entry>[] = [
    {
      header: "Name",
      cell: (e) => (
        <a
          href={`/hr/payroll-entries/${e.id}`}
          className="font-mono text-sm text-brand-600 hover:text-brand-700"
          onClick={(ev) => ev.stopPropagation()}
        >
          {e.name}
        </a>
      ),
    },
    {
      header: "Period",
      cell: (e) => (
        <span className="text-ink-soft">{dateShort(e.startDate)} → {dateShort(e.endDate)}</span>
      ),
    },
    { header: "Mode",  cell: (e) => <span className="text-ink-soft">{e.paymentMode}</span> },
    {
      header: "Slips",
      align: "right",
      cell: (e) => <span className="tabular-nums text-ink">{e.slipsCount}</span>,
    },
    {
      header: "Gross",
      align: "right",
      cell: (e) => <span className="tabular-nums text-ink-soft">{money(Number(e.totalGross))}</span>,
    },
    {
      header: "Net",
      align: "right",
      cell: (e) => <span className="tabular-nums font-medium text-ink">{money(Number(e.totalNet))}</span>,
    },
    { header: "Status", cell: (e) => <StatusBadge status={e.status} /> },
  ];

  return (
    <>
      <PageHeader
        title="Payroll Entries"
        subtitle={
          totalSubmittedNet > 0
            ? `${money(totalSubmittedNet)} net across ${counts.Submitted} submitted run${counts.Submitted === 1 ? "" : "s"}`
            : `${rows.length} entr${rows.length === 1 ? "y" : "ies"}`
        }
        actions={<a href="/hr/payroll-entries/new" className="btn-brand">+ New payroll entry</a>}
      />

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}

      <div className="space-y-4">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search payroll #…" }}
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
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(e) => e.id}
          onRowClick={(e) => (window.location.href = `/hr/payroll-entries/${e.id}`)}
          loading={loading}
          empty={{
            icon: Icon.cash,
            title: search || statusFilter !== "all" ? "No matching runs" : "No payroll runs yet",
            description: search || statusFilter !== "all"
              ? "Try changing your search or filter."
              : "Start a payroll run to process a period's slips.",
            action: !search && statusFilter === "all" && (
              <a href="/hr/payroll-entries/new" className="btn-brand">+ New payroll entry</a>
            ),
          }}
        />
      </div>
    </>
  );
}
