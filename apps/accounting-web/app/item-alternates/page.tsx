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
  type Column,
} from "../../components/ui";
import { Icon } from "../../components/app-shell";

interface Alt {
  id: string;
  twoWay: boolean;
  priority: number;
  notes: string | null;
  item: { itemCode: string; itemName: string };
  alternateItem: { itemCode: string; itemName: string };
}

interface Item {
  id: string;
  itemCode: string;
  itemName: string;
}

// Module 49 — Item Alternate list + create Drawer.
export default function ItemAlternatesPage() {
  const [rows, setRows] = useState<Alt[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ itemId: "", alternateItemId: "", twoWay: false, priority: 100, notes: "" });

  async function load() {
    setLoading(true);
    try {
      const [a, i] = await Promise.all([
        api.get<Alt[]>("/item-alternates"),
        api.get<Item[]>("/items"),
      ]);
      setRows(a);
      setItems(i);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  useListPageCommands({
    singular: "Item Alternate",
    plural: "Item Alternates",
    refresh: load,
  });
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.itemId || !form.alternateItemId) {
      setError("Pick both primary and alternate item");
      return;
    }
    setError(null);
    try {
      await api.post("/item-alternates", form);
      setShowForm(false);
      setForm({ itemId: "", alternateItemId: "", twoWay: false, priority: 100, notes: "" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  async function remove(r: Alt, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`Remove ${r.item.itemCode} → ${r.alternateItem.itemCode}?`)) return;
    try {
      await api.del(`/item-alternates/${r.id}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.item.itemCode.toLowerCase().includes(q) ||
        r.item.itemName.toLowerCase().includes(q) ||
        r.alternateItem.itemCode.toLowerCase().includes(q) ||
        r.alternateItem.itemName.toLowerCase().includes(q),
    );
  }, [rows, search]);

  const columns: Column<Alt>[] = [
    {
      header: "Primary",
      cell: (r) => (
        <div>
          <div className="font-medium text-ink">{r.item.itemName}</div>
          <div className="text-xs text-ink-muted font-mono">{r.item.itemCode}</div>
        </div>
      ),
    },
    { header: "→", cell: () => <span className="text-ink-muted">→</span> },
    {
      header: "Alternate",
      cell: (r) => (
        <div>
          <div className="font-medium text-ink">{r.alternateItem.itemName}</div>
          <div className="text-xs text-ink-muted font-mono">{r.alternateItem.itemCode}</div>
        </div>
      ),
    },
    {
      header: "2-way",
      cell: (r) =>
        r.twoWay ? <span className="badge-blue text-xs">yes</span> : <span className="text-ink-muted text-xs">—</span>,
    },
    { header: "Priority", align: "right", cell: (r) => <span className="font-mono">{r.priority}</span> },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <button onClick={(e) => remove(r, e)} className="btn-ghost btn-sm text-red-600">Delete</button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Item Alternates"
        subtitle="Define substitute items. PO/SO forms suggest alternates when the primary is out of stock."
        actions={<Button variant="brand" onClick={() => setShowForm(true)}>+ New pair</Button>}
      />

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}

      <div className="space-y-4">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search item code / name…" }}
          actions={<SavedViewsControls listKey="accounting-web:item-alternates" current={{ search }} onApply={(fv) => setSearch(fv.search)} />}
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.id}
          loading={loading}
          empty={{
            icon: Icon.layers,
            title: search ? "No matches" : "No substitute pairs yet",
            description: "Add pairs so buyers can pick a fallback item when the primary is out of stock.",
            action: !search && <Button variant="brand" onClick={() => setShowForm(true)}>+ New pair</Button>,
          }}
        />
      </div>

      <Drawer
        open={showForm}
        onClose={() => setShowForm(false)}
        title="New substitute pair"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button variant="brand" onClick={(e) => submit(e as unknown as React.FormEvent)}>Create</Button>
          </>
        }
      >
        <form onSubmit={submit} className="space-y-4">
          <FormField label="Primary item" required hint="Out-of-stock item that needs a substitute">
            <select className="input" value={form.itemId} onChange={(e) => setForm({ ...form, itemId: e.target.value })} required>
              <option value="">— pick —</option>
              {items.map((i) => <option key={i.id} value={i.id}>{i.itemCode} · {i.itemName}</option>)}
            </select>
          </FormField>
          <FormField label="Alternate item" required hint="Substitute to suggest">
            <select className="input" value={form.alternateItemId} onChange={(e) => setForm({ ...form, alternateItemId: e.target.value })} required>
              <option value="">— pick —</option>
              {items.filter((i) => i.id !== form.itemId).map((i) => <option key={i.id} value={i.id}>{i.itemCode} · {i.itemName}</option>)}
            </select>
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Priority" hint="Lower = higher preference">
              <input type="number" className="input font-mono" value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })} />
            </FormField>
            <FormField label="Two-way">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.twoWay} onChange={(e) => setForm({ ...form, twoWay: e.target.checked })} />
                Also suggest primary when alternate is out
              </label>
            </FormField>
          </div>
          <FormField label="Notes">
            <input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </FormField>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </>
  );
}
