"use client";

import { useEffect, useMemo, useState } from "react";
import { useListPageCommands, SavedViewsControls, useRealtimeList } from "@lumaara/web-ui";
import { api } from "../../lib/api";
import {
  Button,
  DataTable,
  Drawer,
  FilterBar,
  FormField,
  PageHeader,
  Segmented,
  StatusBadge,
  Toast,
  dateShort,
  money,
  type Column,
} from "../../components/ui";
import { Icon } from "../../components/app-shell";

interface RecurringInvoice {
  id: string;
  name: string;
  title: string;
  customerId: string;
  currency: string;
  frequency: "Daily" | "Weekly" | "Monthly" | "Quarterly" | "Yearly";
  intervalCount: number;
  startDate: string;
  endDate: string | null;
  daysUntilDue: number;
  status: "Active" | "Paused" | "Ended";
  nextRunDate: string;
  lastGeneratedAt: string | null;
  generatedCount: number;
  customer: { id: string; customerName: string };
  _count: { items: number };
}

interface Customer { id: string; customerName: string }
interface Item { id: string; itemCode: string; itemName: string; standardRate: string }

type StatusFilter = "all" | "Active" | "Paused" | "Ended";
const FREQ = ["Daily", "Weekly", "Monthly", "Quarterly", "Yearly"] as const;

const emptyForm = {
  title: "",
  customerId: "",
  currency: "INR",
  frequency: "Monthly" as (typeof FREQ)[number],
  intervalCount: 1,
  startDate: new Date().toISOString().slice(0, 10),
  endDate: "",
  daysUntilDue: 30,
  items: [{ itemId: "", qty: 1, rate: 0 }],
};

export default function RecurringInvoicesPage() {
  const [rows, setRows] = useState<RecurringInvoice[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [rs, cs, its] = await Promise.all([
        api.get<RecurringInvoice[]>(
          `/recurring-invoices${statusFilter !== "all" ? `?status=${statusFilter}` : ""}`,
        ),
        api.get<Customer[]>("/customers"),
        api.get<Item[]>("/items"),
      ]);
      setRows(rs);
      setCustomers(cs);
      setItems(its);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  useListPageCommands({
    singular: "Recurring Invoice",
    plural: "Recurring Invoices",
    refresh: load,
  });
  useRealtimeList("recurring-invoice", load);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = {
        ...form,
        endDate: form.endDate || null,
        items: form.items
          .filter((i) => i.itemId && i.qty > 0)
          .map((i) => ({ itemId: i.itemId, qty: Number(i.qty), rate: Number(i.rate) })),
      };
      if (payload.items.length === 0) throw new Error("Add at least one item");
      await api.post<RecurringInvoice>("/recurring-invoices", payload);
      setForm(emptyForm);
      setShowForm(false);
      setMsg("Template created");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create");
    } finally {
      setBusy(false);
    }
  }

  async function toggleStatus(r: RecurringInvoice) {
    try {
      const action = r.status === "Active" ? "pause" : r.status === "Paused" ? "resume" : null;
      if (!action) return;
      await api.post(`/recurring-invoices/${r.id}/${action}`, {});
      setMsg(action === "pause" ? "Paused" : "Resumed");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  async function generateNow(r: RecurringInvoice) {
    if (!confirm(`Generate an invoice from "${r.title}" now?`)) return;
    try {
      await api.post(`/recurring-invoices/${r.id}/generate-now`, {});
      setMsg(`Invoice generated from ${r.name}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate");
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.name, r.title, r.customer.customerName]
        .filter(Boolean)
        .some((v) => v.toLowerCase().includes(q)),
    );
  }, [rows, search]);

  const counts = useMemo(
    () => ({
      all: rows.length,
      Active: rows.filter((r) => r.status === "Active").length,
      Paused: rows.filter((r) => r.status === "Paused").length,
      Ended: rows.filter((r) => r.status === "Ended").length,
    }),
    [rows],
  );

  const columns: Column<RecurringInvoice>[] = [
    {
      header: "Name",
      cell: (r) => (
        <a
          href={`/accounting/recurring-invoices/${r.id}`}
          className="font-mono text-sm text-brand-600 hover:text-brand-700"
          onClick={(e) => e.stopPropagation()}
        >
          {r.name}
        </a>
      ),
    },
    {
      header: "Title",
      cell: (r) => (
        <a
          href={`/accounting/recurring-invoices/${r.id}`}
          className="font-medium text-ink hover:text-brand-700"
          onClick={(e) => e.stopPropagation()}
        >
          {r.title}
        </a>
      ),
    },
    { header: "Customer", cell: (r) => <span className="text-ink-soft">{r.customer.customerName}</span> },
    {
      header: "Cadence",
      cell: (r) => (
        <span className="text-ink-soft">
          {r.intervalCount === 1 ? "" : `Every ${r.intervalCount} × `}{r.frequency}
        </span>
      ),
    },
    { header: "Next run", cell: (r) => <span className="text-ink-soft">{dateShort(r.nextRunDate)}</span> },
    { header: "Generated", align: "right", cell: (r) => <span className="tabular-nums text-ink-soft">{r.generatedCount}</span> },
    { header: "Status",   cell: (r) => <StatusBadge status={r.status} /> },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <div className="flex items-center gap-2 justify-end">
          {r.status !== "Ended" && (
            <button
              onClick={(e) => { e.stopPropagation(); generateNow(r); }}
              className="text-xs text-brand-600 hover:underline"
            >
              Run now
            </button>
          )}
          {r.status === "Active" && (
            <button
              onClick={(e) => { e.stopPropagation(); toggleStatus(r); }}
              className="text-xs text-ink-soft hover:text-brand-700"
            >
              Pause
            </button>
          )}
          {r.status === "Paused" && (
            <button
              onClick={(e) => { e.stopPropagation(); toggleStatus(r); }}
              className="text-xs text-emerald-600 hover:underline"
            >
              Resume
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Recurring Invoices"
        subtitle={`${counts.Active} active · ${counts.Paused} paused · ${counts.Ended} ended`}
        actions={
          <Button variant="brand" onClick={() => setShowForm(true)}>
            + New template
          </Button>
        }
      />

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}
      {msg   && <div className="mb-4"><Toast kind="success" message={msg}   onDismiss={() => setMsg(null)} /></div>}

      <div className="space-y-4">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search title, customer…" }}
          filters={
            <Segmented
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: "all",    label: "All",    count: counts.all },
                { value: "Active", label: "Active", count: counts.Active },
                { value: "Paused", label: "Paused", count: counts.Paused },
                { value: "Ended",  label: "Ended",  count: counts.Ended },
              ]}
        />
          }
          actions={<SavedViewsControls listKey="accounting-web:recurring-invoices" current={{ search, statusFilter }} onApply={(fv) => { setSearch(fv.search); setStatusFilter(fv.statusFilter); }} />}
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.id}
          loading={loading}
          empty={{
            icon: Icon.calendar,
            title: search || statusFilter !== "all" ? "No matching templates" : "No recurring invoices yet",
            description: search || statusFilter !== "all"
              ? "Try changing your search or filter."
              : "Set up a template and Lumaara will auto-generate invoices on your schedule.",
            action: !search && statusFilter === "all" && (
              <Button variant="brand" onClick={() => setShowForm(true)}>+ New template</Button>
            ),
          }}
        />
      </div>

      <Drawer
        open={showForm}
        onClose={() => setShowForm(false)}
        title="New recurring template"
        width="w-[640px]"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button
              variant="brand"
              onClick={(e) => save(e as unknown as React.FormEvent)}
              disabled={busy}
            >
              {busy ? "Creating…" : "Create template"}
            </Button>
          </>
        }
      >
        <form onSubmit={save} className="space-y-4">
          <FormField label="Title" required>
            <input
              className="input"
              placeholder="e.g. Monthly SaaS — Acme Corp"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              required
              autoFocus
            />
          </FormField>

          <FormField label="Customer" required>
            <select
              className="input"
              value={form.customerId}
              onChange={(e) => setForm({ ...form, customerId: e.target.value })}
              required
            >
              <option value="">Select customer…</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.customerName}</option>
              ))}
            </select>
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Frequency" required>
              <select
                className="input"
                value={form.frequency}
                onChange={(e) => setForm({ ...form, frequency: e.target.value as (typeof FREQ)[number] })}
              >
                {FREQ.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </FormField>
            <FormField label="Every N" required>
              <input
                type="number"
                min={1}
                className="input"
                value={form.intervalCount}
                onChange={(e) => setForm({ ...form, intervalCount: Number(e.target.value) || 1 })}
              />
            </FormField>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <FormField label="Start date" required>
              <input
                type="date"
                className="input"
                value={form.startDate}
                onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                required
              />
            </FormField>
            <FormField label="End date (optional)">
              <input
                type="date"
                className="input"
                value={form.endDate}
                onChange={(e) => setForm({ ...form, endDate: e.target.value })}
              />
            </FormField>
            <FormField label="Days until due" required>
              <input
                type="number"
                min={0}
                className="input"
                value={form.daysUntilDue}
                onChange={(e) => setForm({ ...form, daysUntilDue: Number(e.target.value) || 0 })}
              />
            </FormField>
          </div>

          {/* Line items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="label mb-0">Line items</label>
              <button
                type="button"
                onClick={() => setForm({ ...form, items: [...form.items, { itemId: "", qty: 1, rate: 0 }] })}
                className="text-xs text-brand-600 hover:underline"
              >
                + Add row
              </button>
            </div>
            <div className="card overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-surface-sunken text-ink-muted">
                  <tr>
                    <th className="px-3 py-2 text-start text-[11px] uppercase font-semibold">Item</th>
                    <th className="px-3 py-2 text-end text-[11px] uppercase font-semibold w-20">Qty</th>
                    <th className="px-3 py-2 text-end text-[11px] uppercase font-semibold w-28">Rate</th>
                    <th className="px-3 py-2 text-end text-[11px] uppercase font-semibold w-28">Amount</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {form.items.map((row, i) => {
                    const amount = (Number(row.qty) || 0) * (Number(row.rate) || 0);
                    return (
                      <tr key={i} className="border-t border-ink-muted/10">
                        <td className="px-2 py-1">
                          <select
                            className="input input-sm"
                            value={row.itemId}
                            onChange={(e) => {
                              const item = items.find((it) => it.id === e.target.value);
                              const next = [...form.items];
                              next[i] = {
                                ...row,
                                itemId: e.target.value,
                                rate: row.rate || Number(item?.standardRate ?? 0),
                              };
                              setForm({ ...form, items: next });
                            }}
                          >
                            <option value="">Select…</option>
                            {items.map((it) => (
                              <option key={it.id} value={it.id}>{it.itemCode} — {it.itemName}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-1">
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            className="input input-sm text-end"
                            value={row.qty}
                            onChange={(e) => {
                              const next = [...form.items];
                              next[i] = { ...row, qty: Number(e.target.value) };
                              setForm({ ...form, items: next });
                            }}
                          />
                        </td>
                        <td className="px-2 py-1">
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            className="input input-sm text-end"
                            value={row.rate}
                            onChange={(e) => {
                              const next = [...form.items];
                              next[i] = { ...row, rate: Number(e.target.value) };
                              setForm({ ...form, items: next });
                            }}
                          />
                        </td>
                        <td className="px-3 py-2 text-end tabular-nums text-ink-soft">
                          {money(amount, form.currency)}
                        </td>
                        <td className="px-2 py-1 text-end">
                          <button
                            type="button"
                            onClick={() => {
                              const next = form.items.filter((_, idx) => idx !== i);
                              setForm({ ...form, items: next.length ? next : [{ itemId: "", qty: 1, rate: 0 }] });
                            }}
                            className="text-xs text-red-600 hover:underline"
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </>
  );
}
