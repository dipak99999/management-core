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

interface JELine {
  id: string;
  debit: string;
  credit: string;
  account: { accountName: string };
}
interface JE {
  id: string;
  name: string;
  postingDate: string;
  status: string;
  remarks: string | null;
  accounts: JELine[];
}

type StatusFilter = "all" | "Draft" | "Submitted" | "Cancelled";

export default function JournalEntriesPage() {
  const [rows, setRows] = useState<JE[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const { qs } = useCompanyScope();

  async function load() {
    setLoading(true);
    try {
      setRows(await api.get<JE[]>(`/journal-entries${qs}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qs]);

  useListPageCommands({
    singular: "Journal Entry",
    plural: "Journal Entries",
    newHref: "/accounting/journal-entries/new",
    refresh: load,
  });
  useRealtimeList("journal-entry", load);

  const tourSteps: TourStep[] = [
    { target: "[data-tour=accounting-journal-entries-v1-header]", title: "Journal Entries", body: "This is where you manage journal entries. Filter by status, search by name, and drill into any row for details.", placement: "bottom" },
    { target: "[data-tour=accounting-journal-entries-v1-new]", title: "Create a new journal entry", body: "Click here to add your first journal entry. The form captures all the required fields and lets you save as draft or submit immediately.", placement: "bottom" },
    { target: "[data-tour=accounting-journal-entries-v1-filter]", title: "Save a filtered view", body: "Narrow down with the filters, then use the Views menu to save and name the filter set so it's one click next time.", placement: "bottom" },
  ];

  async function submit(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await api.post(`/journal-entries/${id}/submit`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submit failed");
    }
  }
  async function cancel(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await api.post(`/journal-entries/${id}/cancel`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cancel failed");
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (q) {
        const accountNames = r.accounts.map((a) => a.account.accountName).join(" ");
        if (!`${r.name} ${accountNames} ${r.remarks ?? ""}`.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [rows, search, statusFilter]);

  const bulk = useBulkSelect(filtered);
  const bulkActions: BulkAction<JE>[] = standardBulkActions<JE>({
    base: "/journal-entries",
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

  const totalPosted = useMemo(
    () => rows
      .filter((r) => r.status === "Submitted")
      .reduce((s, r) => s + r.accounts.reduce((t, a) => t + Number(a.debit), 0), 0),
    [rows],
  );

  const columns: Column<JE>[] = [
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
      header: "Entry",
      cell: (r) => (
        <a
          href={`/accounting/journal-entries/${r.id}`}
          className="font-mono text-sm text-brand-600 hover:text-brand-700"
          onClick={(e) => e.stopPropagation()}
        >
          {r.name}
        </a>
      ),
    },
    { header: "Date", cell: (r) => <span className="text-ink-soft">{dateShort(r.postingDate)}</span> },
    {
      header: "Accounts",
      cell: (r) => (
        <span className="text-xs text-ink-soft truncate max-w-md inline-block">
          {r.accounts.map((a) => a.account.accountName).join(", ")}
        </span>
      ),
    },
    {
      header: "Total Debit",
      align: "right",
      cell: (r) => {
        const total = r.accounts.reduce((s, a) => s + Number(a.debit), 0);
        return <span className="tabular-nums font-medium text-ink">{money(total)}</span>;
      },
    },
    { header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <div className="flex items-center justify-end gap-2">
          {r.status === "Draft" && (
            <button onClick={(e) => submit(r.id, e)} className="btn-ghost btn-sm">Submit</button>
          )}
          {r.status !== "Cancelled" && (
            <button onClick={(e) => cancel(r.id, e)} className="btn-ghost btn-sm text-red-600">Cancel</button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <Tour id="accounting-web.journal-entries.v1" steps={tourSteps} />
      <div data-tour="accounting-journal-entries-v1-header">
      <PageHeader
        title="Journal Entries"
        subtitle={
          totalPosted > 0
            ? `${money(totalPosted)} posted across ${counts.Submitted} submitted entr${counts.Submitted === 1 ? "y" : "ies"}`
            : `${rows.length} entr${rows.length === 1 ? "y" : "ies"}`
        }
        actions={<a href="/accounting/journal-entries/new" className="btn-brand" data-tour="accounting-journal-entries-v1-new">+ New entry</a>}
      />
      </div>

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}

      <div className="space-y-4">
        <div data-tour="accounting-journal-entries-v1-filter">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search entry # or account…" }}
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
        actions={<SavedViewsControls listKey="accounting-web:journal-entries" current={{ search, statusFilter }} onApply={(f) => { setSearch(f.search); setStatusFilter(f.statusFilter); }} />}
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
          onRowClick={(r) => (window.location.href = `/accounting/journal-entries/${r.id}`)}
          loading={loading}
          empty={{
            icon: Icon.book,
            title: search || statusFilter !== "all" ? "No matching entries" : "No journal entries yet",
            description: search || statusFilter !== "all"
              ? "Try changing your search or filter."
              : "Post your first journal entry to move money between accounts.",
            action: !search && statusFilter === "all" && (
              <a href="/accounting/journal-entries/new" className="btn-brand">+ New entry</a>
            ),
          }}
        />
      </div>
    </>
  );
}
