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
  StatusBadge,
  Toast,
  dateShort,
  type Column,
} from "../../components/ui";
import { Icon } from "../../components/app-shell";
import { useCompanyScope } from "../../components/company-scope";

interface RFQRow {
  id: string;
  name: string;
  transactionDate: string;
  responseDueDate: string | null;
  status: string;
  suppliers: { supplierId: string; supplierName: string; responseStatus: string }[];
  items: { id: string; itemId: string; qty: string }[];
  _count: { quotations: number };
}

interface Supplier {
  id: string;
  supplierName: string;
}

interface Item {
  id: string;
  itemCode: string;
  itemName: string;
}

// Module 45 — RFQ list + create.
// Buyers pick items to source + invite suppliers; each RFQ is a Draft
// they Submit when ready. From the list they navigate to the detail
// page (`/[id]`) which hosts the compare-quotes UI + award action.
export default function RequestForQuotationsPage() {
  const [rows, setRows] = useState<RFQRow[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const { qs } = useCompanyScope();

  const [form, setForm] = useState({
    responseDueDate: "",
    message: "",
    supplierIds: [] as string[],
    items: [{ itemId: "", qty: 1, description: "" }],
  });

  async function load() {
    setLoading(true);
    try {
      const [r, s, i] = await Promise.all([
        api.get<RFQRow[]>(`/request-for-quotations${qs}`),
        api.get<Supplier[]>("/suppliers"),
        api.get<Item[]>("/items"),
      ]);
      setRows(r);
      setSuppliers(s);
      setItems(i);
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
    singular: "Request For Quotation",
    plural: "Request For Quotations",
    refresh: load,
  });
  function openCreate() {
    setForm({
      responseDueDate: "",
      message: "",
      supplierIds: [],
      items: [{ itemId: "", qty: 1, description: "" }],
    });
    setShowForm(true);
  }

  function toggleSupplier(id: string) {
    setForm((prev) => ({
      ...prev,
      supplierIds: prev.supplierIds.includes(id)
        ? prev.supplierIds.filter((s) => s !== id)
        : [...prev.supplierIds, id],
    }));
  }

  function addItemRow() {
    setForm((prev) => ({ ...prev, items: [...prev.items, { itemId: "", qty: 1, description: "" }] }));
  }
  function removeItemRow(idx: number) {
    setForm((prev) => ({ ...prev, items: prev.items.filter((_, i) => i !== idx) }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (form.supplierIds.length === 0) {
      setError("Invite at least one supplier");
      return;
    }
    if (form.items.some((i) => !i.itemId || Number(i.qty) <= 0)) {
      setError("Every line needs an item + positive qty");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await api.post("/request-for-quotations", {
        responseDueDate: form.responseDueDate
          ? new Date(form.responseDueDate).toISOString()
          : null,
        message: form.message || null,
        suppliers: form.supplierIds.map((sid) => ({ supplierId: sid })),
        items: form.items.map((i) => ({
          itemId: i.itemId,
          qty: Number(i.qty),
          description: i.description || null,
        })),
      });
      setShowForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function submitRFQ(r: RFQRow, e: React.MouseEvent) {
    e.stopPropagation();
    setError(null);
    try {
      await api.post(`/request-for-quotations/${r.id}/submit`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submit failed");
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(q));
  }, [rows, search]);

  const columns: Column<RFQRow>[] = [
    {
      header: "Name",
      cell: (r) => (
        <a href={`/buying/request-for-quotations/${r.id}`} className="font-medium text-brand-600 hover:underline">
          {r.name}
        </a>
      ),
    },
    { header: "Date", cell: (r) => <span className="text-sm">{dateShort(r.transactionDate)}</span> },
    {
      header: "Response by",
      cell: (r) => (
        <span className="text-sm text-ink-soft">
          {r.responseDueDate ? dateShort(r.responseDueDate) : "—"}
        </span>
      ),
    },
    {
      header: "Suppliers",
      cell: (r) => (
        <span className="text-xs text-ink-muted">
          {r.suppliers.length} invited · {r.suppliers.filter((s) => s.responseStatus === "Quoted").length} quoted
        </span>
      ),
    },
    { header: "Items", cell: (r) => <span>{r.items.length}</span> },
    { header: "Quotes", cell: (r) => <span>{r._count.quotations}</span> },
    { header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <div className="flex items-center justify-end gap-1">
          {r.status === "Draft" && (
            <button onClick={(e) => submitRFQ(r, e)} className="btn-ghost btn-sm">
              Submit
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Request for Quotation"
        subtitle="Invite suppliers to quote on your material needs, compare bids side-by-side, award the winner."
        actions={<Button variant="brand" onClick={openCreate}>+ New RFQ</Button>}
      />

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}

      <div className="space-y-4">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search RFQ number…" }}
          actions={<SavedViewsControls listKey="buying-web:request-for-quotations" current={{ search }} onApply={(fv) => setSearch(fv.search)} />}
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.id}
          loading={loading}
          empty={{
            icon: Icon.book,
            title: search ? "No matching RFQs" : "No RFQs yet",
            description: "Send your first RFQ to multiple suppliers and pick the best quote.",
            action: !search && <Button variant="brand" onClick={openCreate}>+ New RFQ</Button>,
          }}
        />
      </div>

      <Drawer
        open={showForm}
        onClose={() => setShowForm(false)}
        title="New Request for Quotation"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button variant="brand" disabled={busy} onClick={(e) => submit(e as unknown as React.FormEvent)}>
              Create RFQ
            </Button>
          </>
        }
      >
        <form onSubmit={submit} className="space-y-4">
          <FormField label="Response due">
            <input
              type="date"
              className="input"
              value={form.responseDueDate}
              onChange={(e) => setForm({ ...form, responseDueDate: e.target.value })}
            />
          </FormField>
          <FormField label="Message to suppliers">
            <textarea
              className="input"
              rows={3}
              value={form.message}
              onChange={(e) => setForm({ ...form, message: e.target.value })}
              placeholder="Optional — spec, delivery terms, etc."
            />
          </FormField>

          <FormField label="Invite suppliers" required>
            <div className="border border-line rounded max-h-52 overflow-y-auto">
              {suppliers.map((s) => (
                <label
                  key={s.id}
                  className="flex items-center gap-2 p-2 border-b border-line last:border-0 hover:bg-surface-sunken cursor-pointer text-sm"
                >
                  <input
                    type="checkbox"
                    checked={form.supplierIds.includes(s.id)}
                    onChange={() => toggleSupplier(s.id)}
                  />
                  <span className="font-medium text-ink">{s.supplierName}</span>
                </label>
              ))}
              {suppliers.length === 0 && (
                <div className="p-3 text-sm text-ink-muted italic">No suppliers yet.</div>
              )}
            </div>
            <div className="mt-1 text-xs text-ink-muted">{form.supplierIds.length} invited</div>
          </FormField>

          <FormField label="Line items" required>
            <div className="space-y-2">
              {form.items.map((line, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_80px_auto] gap-2">
                  <select
                    className="input"
                    value={line.itemId}
                    onChange={(e) => {
                      const next = [...form.items];
                      next[idx] = { ...line, itemId: e.target.value };
                      setForm({ ...form, items: next });
                    }}
                  >
                    <option value="">— pick item —</option>
                    {items.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.itemCode} · {i.itemName}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    step="0.01"
                    className="input font-mono"
                    value={line.qty}
                    onChange={(e) => {
                      const next = [...form.items];
                      next[idx] = { ...line, qty: Number(e.target.value) };
                      setForm({ ...form, items: next });
                    }}
                  />
                  <button
                    type="button"
                    className="btn-ghost btn-sm text-red-600"
                    onClick={() => removeItemRow(idx)}
                    disabled={form.items.length <= 1}
                  >
                    ×
                  </button>
                </div>
              ))}
              <button type="button" className="btn-ghost btn-sm" onClick={addItemRow}>
                + Add line
              </button>
            </div>
          </FormField>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </>
  );
}
