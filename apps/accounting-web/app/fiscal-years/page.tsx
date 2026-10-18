"use client";

import { useEffect, useMemo, useState } from "react";
import { useListPageCommands, SavedViewsControls } from "@lumaara/web-ui";
import { api } from "../../lib/api";
import {
  Button,
  DataTable,
  Drawer,
  FilterBar,
  FormField,
  PageHeader,
  Toast,
  dateShort,
  type Column,
} from "../../components/ui";
import { Icon } from "../../components/app-shell";

interface FiscalYear {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  closedTill: string | null;
  closedAt: string | null;
  closedBy: string | null;
}

const emptyForm = { name: "", startDate: "", endDate: "", isCurrent: false };

export default function FiscalYearsPage() {
  const [rows, setRows] = useState<FiscalYear[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");

  async function load() {
    setLoading(true);
    try {
      setRows(await api.get<FiscalYear[]>("/fiscal-years"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  useListPageCommands({
    singular: "Fiscal Year",
    plural: "Fiscal Years",
    refresh: load,
  });
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post("/fiscal-years", {
        name: form.name,
        startDate: new Date(form.startDate).toISOString(),
        endDate: new Date(form.endDate).toISOString(),
        isCurrent: form.isCurrent,
      });
      setForm(emptyForm);
      setShowForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function closeYear(fy: FiscalYear, e: React.MouseEvent) {
    e.stopPropagation();
    const input = prompt(
      `Close periods up to which date? (YYYY-MM-DD; must be within ${fy.startDate.slice(0, 10)}..${fy.endDate.slice(0, 10)})`,
      fy.endDate.slice(0, 10),
    );
    if (!input) return;
    setError(null);
    try {
      await api.post(`/fiscal-years/${fy.id}/close`, {
        closedTill: new Date(input).toISOString(),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Close failed");
    }
  }

  async function reopenYear(fy: FiscalYear, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`Reopen ${fy.name}? GL posts to closed periods will be allowed again.`)) return;
    setError(null);
    try {
      await api.post(`/fiscal-years/${fy.id}/reopen`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reopen failed");
    }
  }

  async function yearEndClose(fy: FiscalYear, e: React.MouseEvent) {
    e.stopPropagation();
    setError(null);
    try {
      const preview = await api.post<{
        preview: true;
        netProfit: number;
        lines: { accountId: string; debit: number; credit: number; remarks?: string }[];
      }>(`/fiscal-years/${fy.id}/year-end-close?preview=1`, {});
      const msg =
        `Year-end close for ${fy.name}:\n\n` +
        `Net ${preview.netProfit >= 0 ? "profit" : "loss"}: ${Math.abs(preview.netProfit).toFixed(2)}\n` +
        `Closing JE will post ${preview.lines.length} lines\n` +
        `(zero out every Income/Expense balance, net to Retained Earnings)\n\n` +
        `Proceed?`;
      if (!confirm(msg)) return;
      await api.post(`/fiscal-years/${fy.id}/year-end-close`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Year-end close failed");
    }
  }

  async function setCurrent(fy: FiscalYear, e: React.MouseEvent) {
    e.stopPropagation();
    setError(null);
    try {
      await api.put(`/fiscal-years/${fy.id}`, { isCurrent: true });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(q));
  }, [rows, search]);

  const currentFY = useMemo(() => rows.find((r) => r.isCurrent), [rows]);

  const columns: Column<FiscalYear>[] = [
    {
      header: "Name",
      cell: (fy) => <span className="font-medium text-ink">{fy.name}</span>,
    },
    {
      header: "Range",
      cell: (fy) => (
        <span className="text-ink-soft text-sm">
          {dateShort(fy.startDate)} → {dateShort(fy.endDate)}
        </span>
      ),
    },
    {
      header: "Current",
      cell: (fy) =>
        fy.isCurrent ? (
          <span className="badge-blue">Current</span>
        ) : (
          <button onClick={(e) => setCurrent(fy, e)} className="btn-ghost btn-sm">Set current</button>
        ),
    },
    {
      header: "Closed through",
      cell: (fy) =>
        fy.closedTill ? (
          <span className="font-mono text-xs text-red-700">{dateShort(fy.closedTill)}</span>
        ) : (
          <span className="text-ink-muted italic text-xs">open</span>
        ),
    },
    {
      header: "",
      align: "right",
      cell: (fy) => (
        <div className="flex items-center justify-end gap-2">
          <button onClick={(e) => closeYear(fy, e)} className="btn-ghost btn-sm">Close…</button>
          <button
            onClick={(e) => yearEndClose(fy, e)}
            className="btn-ghost btn-sm text-brand-600"
            title="Post closing JE + fully close"
          >
            Year-end close…
          </button>
          {fy.closedTill && (
            <button onClick={(e) => reopenYear(fy, e)} className="btn-ghost btn-sm text-red-600">
              Reopen
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Fiscal Years"
        subtitle={
          currentFY
            ? `Current: ${currentFY.name} · ${rows.length} year${rows.length === 1 ? "" : "s"} defined`
            : `${rows.length} year${rows.length === 1 ? "" : "s"} defined`
        }
        actions={
          <Button variant="brand" onClick={() => setShowForm(true)}>+ New fiscal year</Button>
        }
      />

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}

      <div className="space-y-4">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search fiscal years…" }}
          actions={<SavedViewsControls listKey="accounting-web:fiscal-years" current={{ search }} onApply={(fv) => setSearch(fv.search)} />}
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(fy) => fy.id}
          loading={loading}
          empty={{
            icon: Icon.calendar,
            title: search ? "No matching years" : "No fiscal years yet",
            description: search
              ? "Try a different search term."
              : "Create a fiscal year to bound your reporting periods and enable period locking.",
            action: !search && (
              <Button variant="brand" onClick={() => setShowForm(true)}>+ Add fiscal year</Button>
            ),
          }}
        />
      </div>

      <Drawer
        open={showForm}
        onClose={() => setShowForm(false)}
        title="New fiscal year"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button
              variant="brand"
              disabled={busy}
              onClick={(e) => create(e as unknown as React.FormEvent)}
            >
              Create fiscal year
            </Button>
          </>
        }
      >
        <form onSubmit={create} className="space-y-4">
          <FormField label="Name" required>
            <input
              className="input"
              placeholder="e.g. FY 2025-26"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              autoFocus
            />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Start date" required>
              <input
                type="date"
                className="input"
                value={form.startDate}
                onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                required
              />
            </FormField>
            <FormField label="End date" required>
              <input
                type="date"
                className="input"
                value={form.endDate}
                onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                required
              />
            </FormField>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isCurrent}
              onChange={(e) => setForm({ ...form, isCurrent: e.target.checked })}
            />
            Set as current fiscal year
          </label>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </>
  );
}
