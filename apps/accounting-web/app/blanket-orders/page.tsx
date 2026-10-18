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

interface BlanketOrder {
  id: string;
  name: string;
  blanketType: string;
  validFrom: string;
  validTill: string;
  currency: string;
  status: string;
  customer: { customerName: string } | null;
  supplier: { supplierName: string } | null;
  _count: { items: number };
}

interface Party { id: string; name: string; }
interface Item { id: string; itemCode: string; itemName: string; }

// Module 50 — Blanket Order list + create (selling + buying).
export default function BlanketOrdersPage() {
  const [rows, setRows] = useState<BlanketOrder[]>([]);
  const [customers, setCustomers] = useState<Party[]>([]);
  const [suppliers, setSuppliers] = useState<Party[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<{
    blanketType: "Selling" | "Buying";
    customerId: string;
    supplierId: string;
    validFrom: string;
    validTill: string;
    currency: string;
    items: Array<{ itemId: string; qty: number; rate: number; description: string }>;
  }>({
    blanketType: "Selling",
    customerId: "",
    supplierId: "",
    validFrom: "",
    validTill: "",
    currency: "INR",
    items: [{ itemId: "", qty: 1, rate: 0, description: "" }],
  });

  async function load() {
    setLoading(true);
    try {
      const [b, c, s, i] = await Promise.all([
        api.get<BlanketOrder[]>("/blanket-orders"),
        api.get<Array<{ id: string; customerName: string }>>("/customers"),
        api.get<Array<{ id: string; supplierName: string }>>("/suppliers"),
        api.get<Item[]>("/items"),
      ]);
      setRows(b);
      setCustomers(c.map((x) => ({ id: x.id, name: x.customerName })));
      setSuppliers(s.map((x) => ({ id: x.id, name: x.supplierName })));
      setItems(i);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  useListPageCommands({
    singular: "Blanket Order",
    plural: "Blanket Orders",
    refresh: load,
  });
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/blanket-orders", {
        blanketType: form.blanketType,
        customerId: form.blanketType === "Selling" ? form.customerId : null,
        supplierId: form.blanketType === "Buying" ? form.supplierId : null,
        validFrom: new Date(form.validFrom).toISOString(),
        validTill: new Date(form.validTill).toISOString(),
        currency: form.currency,
        items: form.items,
      });
      setShowForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  async function activate(bo: BlanketOrder, e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await api.post(`/blanket-orders/${bo.id}/activate`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  async function cancel(bo: BlanketOrder, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`Cancel ${bo.name}?`)) return;
    try {
      await api.post(`/blanket-orders/${bo.id}/cancel`, {});
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

  const columns: Column<BlanketOrder>[] = [
    { header: "Name", cell: (r) => <span className="font-medium text-ink">{r.name}</span> },
    { header: "Type", cell: (r) => <span className="text-sm">{r.blanketType}</span> },
    {
      header: "Party",
      cell: (r) => (
        <span className="text-sm">
          {r.customer?.customerName ?? r.supplier?.supplierName ?? "—"}
        </span>
      ),
    },
    {
      header: "Window",
      cell: (r) => (
        <span className="text-xs text-ink-muted">
          {dateShort(r.validFrom)} → {dateShort(r.validTill)}
        </span>
      ),
    },
    { header: "Lines", align: "right", cell: (r) => <span className="font-mono">{r._count.items}</span> },
    { header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <div className="flex items-center justify-end gap-1">
          {r.status === "Draft" && (
            <button onClick={(e) => activate(r, e)} className="btn-ghost btn-sm">Activate</button>
          )}
          {(r.status === "Draft" || r.status === "Active") && (
            <button onClick={(e) => cancel(r, e)} className="btn-ghost btn-sm text-red-600">Cancel</button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Blanket Orders"
        subtitle="Long-term supply / sales agreements. SO/PO created against a blanket draw down its running qty."
        actions={<Button variant="brand" onClick={() => setShowForm(true)}>+ New blanket</Button>}
      />

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}

      <div className="space-y-4">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search blanket number…" }}
          actions={<SavedViewsControls listKey="accounting-web:blanket-orders" current={{ search }} onApply={(fv) => setSearch(fv.search)} />}
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.id}
          loading={loading}
          empty={{
            icon: Icon.clipboard,
            title: search ? "No matches" : "No blanket orders yet",
            description: "Lock in rates + committed qty with a customer or supplier over a validity window.",
            action: !search && <Button variant="brand" onClick={() => setShowForm(true)}>+ New blanket</Button>,
          }}
        />
      </div>

      <Drawer
        open={showForm}
        onClose={() => setShowForm(false)}
        title="New blanket order"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button variant="brand" onClick={(e) => submit(e as unknown as React.FormEvent)}>Create</Button>
          </>
        }
      >
        <form onSubmit={submit} className="space-y-4">
          <FormField label="Type" required>
            <select className="input" value={form.blanketType} onChange={(e) => setForm({ ...form, blanketType: e.target.value as "Selling" | "Buying" })}>
              <option value="Selling">Selling (customer)</option>
              <option value="Buying">Buying (supplier)</option>
            </select>
          </FormField>
          {form.blanketType === "Selling" ? (
            <FormField label="Customer" required>
              <select className="input" value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })} required>
                <option value="">— pick —</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </FormField>
          ) : (
            <FormField label="Supplier" required>
              <select className="input" value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })} required>
                <option value="">— pick —</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </FormField>
          )}
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Valid from" required>
              <input type="date" className="input" value={form.validFrom} onChange={(e) => setForm({ ...form, validFrom: e.target.value })} required />
            </FormField>
            <FormField label="Valid till" required>
              <input type="date" className="input" value={form.validTill} onChange={(e) => setForm({ ...form, validTill: e.target.value })} required />
            </FormField>
          </div>
          <FormField label="Line items" required>
            <div className="space-y-2">
              {form.items.map((line, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_80px_100px_auto] gap-2">
                  <select
                    className="input"
                    value={line.itemId}
                    onChange={(e) => {
                      const next = [...form.items];
                      next[idx] = { ...line, itemId: e.target.value };
                      setForm({ ...form, items: next });
                    }}
                  >
                    <option value="">— item —</option>
                    {items.map((i) => <option key={i.id} value={i.id}>{i.itemCode} · {i.itemName}</option>)}
                  </select>
                  <input
                    type="number"
                    step="0.01"
                    className="input font-mono"
                    placeholder="Qty"
                    value={line.qty}
                    onChange={(e) => {
                      const next = [...form.items];
                      next[idx] = { ...line, qty: Number(e.target.value) };
                      setForm({ ...form, items: next });
                    }}
                  />
                  <input
                    type="number"
                    step="0.01"
                    className="input font-mono"
                    placeholder="Rate"
                    value={line.rate}
                    onChange={(e) => {
                      const next = [...form.items];
                      next[idx] = { ...line, rate: Number(e.target.value) };
                      setForm({ ...form, items: next });
                    }}
                  />
                  <button
                    type="button"
                    className="btn-ghost btn-sm text-red-600"
                    onClick={() => setForm({ ...form, items: form.items.filter((_, i) => i !== idx) })}
                    disabled={form.items.length <= 1}
                  >×</button>
                </div>
              ))}
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => setForm({ ...form, items: [...form.items, { itemId: "", qty: 1, rate: 0, description: "" }] })}
              >+ Add line</button>
            </div>
          </FormField>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </>
  );
}
