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
  Segmented,
  Toast,
  type Column,
} from "../../components/ui";
import { Icon } from "../../components/app-shell";

interface PriceList {
  id: string;
  name: string;
  currency: string;
  buyingOrSelling: string;
  isDefault: boolean;
  enabled: boolean;
}

const emptyForm = {
  name: "",
  currency: "INR",
  buyingOrSelling: "Selling" as "Selling" | "Buying",
  isDefault: false,
  enabled: true,
};

type TypeFilter = "all" | "Selling" | "Buying";

export default function PriceListsPage() {
  const [rows, setRows] = useState<PriceList[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");

  async function load() {
    setLoading(true);
    try {
      setRows(await api.get<PriceList[]>("/price-lists"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  useListPageCommands({
    singular: "Price List",
    plural: "Price Lists",
    refresh: load,
  });
  function edit(p: PriceList, e: React.MouseEvent) {
    e.stopPropagation();
    setForm({
      name: p.name,
      currency: p.currency,
      buyingOrSelling: p.buyingOrSelling as "Selling" | "Buying",
      isDefault: p.isDefault,
      enabled: p.enabled,
    });
    setEditingId(p.id);
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
      if (editingId) await api.put(`/price-lists/${editingId}`, form);
      else await api.post("/price-lists", form);
      close();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    }
  }

  async function remove(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm("Delete this price list?")) return;
    try {
      await api.del(`/price-lists/${id}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (typeFilter !== "all" && r.buyingOrSelling !== typeFilter) return false;
      if (q && !`${r.name} ${r.currency}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, search, typeFilter]);

  const counts = useMemo(() => ({
    all:     rows.length,
    Selling: rows.filter((r) => r.buyingOrSelling === "Selling").length,
    Buying:  rows.filter((r) => r.buyingOrSelling === "Buying").length,
  }), [rows]);

  const columns: Column<PriceList>[] = [
    {
      header: "Name",
      cell: (r) => (
        <div className="flex items-center gap-2">
          <a
            href={`/accounting/price-lists/${r.id}`}
            className="font-medium text-ink hover:text-brand-700"
            onClick={(e) => e.stopPropagation()}
          >
            {r.name}
          </a>
          {r.isDefault && <span className="badge-brand">Default</span>}
        </div>
      ),
    },
    {
      header: "Type",
      cell: (r) => (
        <span className={r.buyingOrSelling === "Selling" ? "badge-green" : "badge-blue"}>
          {r.buyingOrSelling}
        </span>
      ),
    },
    { header: "Currency", cell: (r) => <span className="font-mono text-sm text-ink-soft">{r.currency}</span> },
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
        <div className="flex items-center justify-end gap-2">
          <button onClick={(e) => edit(r, e)} className="btn-ghost btn-sm">Edit</button>
          <button onClick={(e) => remove(r.id, e)} className="btn-ghost btn-sm text-red-600">Delete</button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Price Lists"
        subtitle={`${rows.length} price list${rows.length === 1 ? "" : "s"} · ${counts.Selling} selling · ${counts.Buying} buying`}
        actions={
          <Button variant="brand" onClick={() => setShowForm(true)}>+ New price list</Button>
        }
      />

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}

      <div className="space-y-4">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search name or currency…" }}
          filters={
            <Segmented
              value={typeFilter}
              onChange={setTypeFilter}
              options={[
                { value: "all",     label: "All",     count: counts.all },
                { value: "Selling", label: "Selling", count: counts.Selling },
                { value: "Buying",  label: "Buying",  count: counts.Buying },
              ]}
            />
          }
          actions={<SavedViewsControls listKey="accounting-web:price-lists" current={{ search, typeFilter }} onApply={(fv) => { setSearch(fv.search); setTypeFilter(fv.typeFilter); }} />}
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.id}
          onRowClick={(r) => (window.location.href = `/accounting/price-lists/${r.id}`)}
          loading={loading}
          empty={{
            icon: Icon.tag,
            title: search || typeFilter !== "all" ? "No matching price lists" : "No price lists yet",
            description: search || typeFilter !== "all"
              ? "Try changing your search or filter."
              : "Create your first price list to publish item prices.",
            action: !search && typeFilter === "all" && (
              <Button variant="brand" onClick={() => setShowForm(true)}>+ Add price list</Button>
            ),
          }}
        />
      </div>

      <Drawer
        open={showForm}
        onClose={close}
        title={editingId ? "Edit price list" : "New price list"}
        footer={
          <>
            <Button variant="secondary" onClick={close}>Cancel</Button>
            <Button variant="brand" onClick={(e) => save(e as unknown as React.FormEvent)}>
              {editingId ? "Save changes" : "Create price list"}
            </Button>
          </>
        }
      >
        <form onSubmit={save} className="space-y-4">
          <FormField label="Name" required>
            <input
              required
              className="input"
              placeholder="e.g. Standard Selling"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              autoFocus
            />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Currency">
              <input
                className="input font-mono"
                value={form.currency}
                onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })}
              />
            </FormField>
            <FormField label="Type">
              <select
                className="input"
                value={form.buyingOrSelling}
                onChange={(e) =>
                  setForm({ ...form, buyingOrSelling: e.target.value as "Selling" | "Buying" })
                }
              >
                <option>Selling</option>
                <option>Buying</option>
              </select>
            </FormField>
          </div>
          <div className="flex gap-6 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.isDefault}
                onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
              />
              Default
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
              />
              Enabled
            </label>
          </div>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </>
  );
}
