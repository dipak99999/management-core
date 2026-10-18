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

interface Rule {
  id: string;
  itemId: string;
  warehouseId: string;
  reorderLevel: string;
  reorderQty: string;
  materialRequestType: string;
  enabled: boolean;
  item: { itemCode: string; itemName: string; stockUom: string };
  warehouse: { warehouseName: string };
}
interface Item { id: string; itemCode: string; itemName: string }
interface Warehouse { id: string; warehouseName: string; isGroup: boolean }

const emptyForm = {
  itemId: "",
  warehouseId: "",
  reorderLevel: 0,
  reorderQty: 0,
  materialRequestType: "Purchase" as
    | "Purchase"
    | "Material Transfer"
    | "Manufacture",
  enabled: true,
};

export default function ReorderRulesPage() {
  const [rows, setRows] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<Item[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");

  async function load() {
    setLoading(true);
    try {
      setRows(await api.get<Rule[]>("/item-reorder-rules"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    api.get<Item[]>("/items").then(setItems).catch(() => {});
    api
      .get<Warehouse[]>("/warehouses")
      .then((w) => setWarehouses(w.filter((x) => !x.isGroup)))
      .catch(() => {});
  }, []);

  useListPageCommands({
    singular: "Reorder Rule",
    plural: "Reorder Rules",
    refresh: load,
  });
  function edit(r: Rule) {
    setForm({
      itemId: r.itemId,
      warehouseId: r.warehouseId,
      reorderLevel: Number(r.reorderLevel),
      reorderQty: Number(r.reorderQty),
      materialRequestType: r.materialRequestType as typeof form.materialRequestType,
      enabled: r.enabled,
    });
    setEditingId(r.id);
    setShowForm(true);
  }
  function close() {
    setForm(emptyForm);
    setEditingId(null);
    setShowForm(false);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      if (editingId) await api.put(`/item-reorder-rules/${editingId}`, form);
      else await api.post("/item-reorder-rules", form);
      close();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this reorder rule?")) return;
    try {
      await api.del(`/item-reorder-rules/${id}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    }
  }

  async function generateMRs() {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const r = await api.post<{
        triggered: number;
        skipped: number;
        created: number;
        mrs: { id: string; name: string; lineCount: number }[];
      }>("/item-reorder-rules/generate-material-requests", {});
      setMsg(
        `Triggered ${r.triggered} rules · ${r.skipped} at/above level · Created ${r.created} MR${r.created === 1 ? "" : "s"}${r.mrs.length ? `: ${r.mrs.map((m) => m.name).join(", ")}` : ""}`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      `${r.item.itemCode} ${r.item.itemName} ${r.warehouse.warehouseName}`.toLowerCase().includes(q),
    );
  }, [rows, search]);

  const columns: Column<Rule>[] = [
    {
      header: "Item",
      cell: (r) => (
        <div>
          <div className="font-medium text-ink">{r.item.itemName}</div>
          <div className="text-xs text-ink-muted font-mono">{r.item.itemCode}</div>
        </div>
      ),
    },
    { header: "Warehouse", cell: (r) => <span className="text-ink-soft">{r.warehouse.warehouseName}</span> },
    {
      header: "Reorder level",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-ink">
          {Number(r.reorderLevel).toFixed(2)} {r.item.stockUom}
        </span>
      ),
    },
    {
      header: "Reorder qty",
      align: "right",
      cell: (r) => <span className="tabular-nums text-ink">{Number(r.reorderQty).toFixed(2)}</span>,
    },
    { header: "MR type", cell: (r) => <span className="text-xs text-ink-soft">{r.materialRequestType}</span> },
    {
      header: "Enabled",
      cell: (r) => (
        <span className={r.enabled ? "badge-green" : "badge-gray"}>
          {r.enabled ? "Yes" : "No"}
        </span>
      ),
    },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <span className="space-x-2">
          <button onClick={(e) => { e.stopPropagation(); edit(r); }} className="btn-ghost btn-sm">Edit</button>
          <button onClick={(e) => { e.stopPropagation(); remove(r.id); }} className="btn-ghost btn-sm text-red-600">Delete</button>
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Reorder Rules"
        subtitle={`${rows.length} rule${rows.length === 1 ? "" : "s"} · ${rows.filter((r) => r.enabled).length} enabled`}
        actions={
          <>
            <Button variant="secondary" onClick={generateMRs} disabled={busy}>
              {busy ? "Working…" : "Generate MRs"}
            </Button>
            <Button variant="brand" onClick={() => setShowForm(true)}>+ New rule</Button>
          </>
        }
      />

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}
      {msg && <div className="mb-4"><Toast kind="success" message={msg} onDismiss={() => setMsg(null)} /></div>}

      <div className="space-y-4">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search item or warehouse…" }}
          actions={<SavedViewsControls listKey="stock-web:reorder-rules" current={{ search }} onApply={(fv) => setSearch(fv.search)} />}
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.id}
          loading={loading}
          empty={{
            icon: Icon.target,
            title: search ? "No matches" : "No reorder rules yet",
            description: search
              ? "Try a different search term."
              : "Define per-(item, warehouse) min stock levels to auto-raise MRs.",
            action: !search && (
              <Button variant="brand" onClick={() => setShowForm(true)}>+ Add rule</Button>
            ),
          }}
        />
      </div>

      <Drawer
        open={showForm}
        onClose={close}
        title={editingId ? "Edit reorder rule" : "New reorder rule"}
        footer={
          <>
            <Button variant="secondary" onClick={close}>Cancel</Button>
            <Button variant="brand" onClick={(e) => save(e as unknown as React.FormEvent)}>
              {editingId ? "Save changes" : "Create rule"}
            </Button>
          </>
        }
      >
        <form onSubmit={save} className="space-y-4">
          <FormField label="Item" required>
            <select
              required
              className="input"
              value={form.itemId}
              onChange={(e) => setForm({ ...form, itemId: e.target.value })}
            >
              <option value="">Item…</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.itemCode} — {i.itemName}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Warehouse" required>
            <select
              required
              className="input"
              value={form.warehouseId}
              onChange={(e) => setForm({ ...form, warehouseId: e.target.value })}
            >
              <option value="">Warehouse…</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.warehouseName}
                </option>
              ))}
            </select>
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Reorder level (min stock)" required>
              <input
                required
                type="number"
                min={0}
                step="any"
                className="input"
                value={form.reorderLevel}
                onChange={(e) => setForm({ ...form, reorderLevel: Number(e.target.value) })}
              />
            </FormField>
            <FormField label="Reorder qty (min order)" required>
              <input
                required
                type="number"
                min={0}
                step="any"
                className="input"
                value={form.reorderQty}
                onChange={(e) => setForm({ ...form, reorderQty: Number(e.target.value) })}
              />
            </FormField>
          </div>
          <FormField label="MR type">
            <select
              className="input"
              value={form.materialRequestType}
              onChange={(e) =>
                setForm({
                  ...form,
                  materialRequestType: e.target.value as typeof form.materialRequestType,
                })
              }
            >
              <option>Purchase</option>
              <option>Material Transfer</option>
              <option>Manufacture</option>
            </select>
          </FormField>
          <FormField label="Enabled">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
              />
              Enabled
            </label>
          </FormField>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </>
  );
}
