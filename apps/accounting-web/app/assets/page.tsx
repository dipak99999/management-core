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

interface Category { id: string; categoryName: string; defaultUsefulLifeMonths: number }
interface Asset {
  id: string;
  assetCode: string;
  assetName: string;
  status: string;
  purchaseDate: string;
  purchasePrice: string;
  salvageValue: string;
  usefulLifeMonths: number;
  currentValue: string;
  location: string | null;
  category: { id: string; categoryName: string };
}

const emptyForm = {
  assetName: "",
  categoryId: "",
  purchaseDate: new Date().toISOString().slice(0, 10),
  purchasePrice: 0,
  salvageValue: 0,
  usefulLifeMonths: 36,
  depreciationMethod: "Straight Line" as "Straight Line" | "WDV",
  wdvAnnualRatePct: 0,
  location: "",
  notes: "",
};

type StatusFilter = "all" | "Draft" | "Depreciating" | "FullyDepreciated" | "Scrapped";

export default function AssetsPage() {
  const [rows, setRows] = useState<Asset[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  async function load() {
    setLoading(true);
    try {
      const [as, cs] = await Promise.all([
        api.get<Asset[]>("/assets"),
        api.get<Category[]>("/asset-categories"),
      ]);
      setRows(as);
      setCategories(cs);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  useListPageCommands({
    singular: "Asset",
    plural: "Assets",
    refresh: load,
  });
  useRealtimeList("asset", load);
  function onCategoryChange(id: string) {
    const c = categories.find((c) => c.id === id);
    setForm({
      ...form,
      categoryId: id,
      usefulLifeMonths: c ? c.defaultUsefulLifeMonths : form.usefulLifeMonths,
    });
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/assets", {
        ...form,
        purchaseDate: new Date(form.purchaseDate).toISOString(),
        location: form.location || null,
        notes: form.notes || null,
      });
      close();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  function close() {
    setForm(emptyForm);
    setShowForm(false);
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (q && !`${r.assetCode} ${r.assetName} ${r.category.categoryName}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, search, statusFilter]);

  const counts = useMemo(() => ({
    all:              rows.length,
    Draft:            rows.filter((r) => r.status === "Draft").length,
    Depreciating:     rows.filter((r) => r.status === "Depreciating").length,
    FullyDepreciated: rows.filter((r) => r.status === "FullyDepreciated").length,
    Scrapped:         rows.filter((r) => r.status === "Scrapped").length,
  }), [rows]);

  const totalBookValue = useMemo(
    () => rows.reduce((s, r) => s + Number(r.currentValue ?? 0), 0),
    [rows],
  );

  const columns: Column<Asset>[] = [
    {
      header: "Code",
      cell: (a) => (
        <a
          href={`/accounting/assets/${a.id}`}
          className="font-mono text-sm text-brand-600 hover:text-brand-700"
          onClick={(e) => e.stopPropagation()}
        >
          {a.assetCode}
        </a>
      ),
    },
    { header: "Name", cell: (a) => <span className="font-medium text-ink">{a.assetName}</span> },
    { header: "Category", cell: (a) => <span className="text-xs text-ink-soft">{a.category.categoryName}</span> },
    { header: "Purchase", cell: (a) => <span className="text-ink-soft">{dateShort(a.purchaseDate)}</span> },
    {
      header: "Price",
      align: "right",
      cell: (a) => <span className="tabular-nums text-ink-soft">{money(Number(a.purchasePrice))}</span>,
    },
    {
      header: "Book value",
      align: "right",
      cell: (a) => <span className="tabular-nums font-medium text-ink">{money(Number(a.currentValue))}</span>,
    },
    { header: "Status", cell: (a) => <StatusBadge status={a.status} /> },
  ];

  return (
    <>
      <PageHeader
        title="Assets"
        subtitle={
          rows.length > 0
            ? `${money(totalBookValue)} book value across ${rows.length} asset${rows.length === 1 ? "" : "s"}`
            : "No assets yet"
        }
        actions={
          <Button variant="brand" onClick={() => setShowForm(true)}>+ New asset</Button>
        }
      />

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}

      <div className="space-y-4">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search code, name, category…" }}
          filters={
            <Segmented
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: "all",              label: "All",         count: counts.all },
                { value: "Draft",            label: "Draft",       count: counts.Draft },
                { value: "Depreciating",     label: "Depreciating", count: counts.Depreciating },
                { value: "FullyDepreciated", label: "Fully depr.",  count: counts.FullyDepreciated },
                { value: "Scrapped",         label: "Scrapped",    count: counts.Scrapped },
              ]}
        />
          }
          actions={<SavedViewsControls listKey="accounting-web:assets" current={{ search, statusFilter }} onApply={(fv) => { setSearch(fv.search); setStatusFilter(fv.statusFilter); }} />}
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(a) => a.id}
          onRowClick={(a) => (window.location.href = `/accounting/assets/${a.id}`)}
          loading={loading}
          empty={{
            icon: Icon.briefcase,
            title: search || statusFilter !== "all" ? "No matching assets" : "No assets yet",
            description: search || statusFilter !== "all"
              ? "Try changing your search or filter."
              : "Add a fixed asset to start tracking depreciation.",
            action: !search && statusFilter === "all" && (
              <Button variant="brand" onClick={() => setShowForm(true)}>+ Add asset</Button>
            ),
          }}
        />
      </div>

      <Drawer
        open={showForm}
        onClose={close}
        title="New asset"
        width="w-[640px]"
        footer={
          <>
            <Button variant="secondary" onClick={close}>Cancel</Button>
            <Button variant="brand" onClick={(e) => create(e as unknown as React.FormEvent)}>Save as draft</Button>
          </>
        }
      >
        <form onSubmit={create} className="space-y-4">
          {categories.length === 0 && (
            <Toast
              kind="info"
              message="Create at least one asset category first — it maps the 3 GL accounts every asset posts to."
            />
          )}
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Asset name" required>
              <input
                required
                className="input"
                placeholder="Asset name"
                value={form.assetName}
                onChange={(e) => setForm({ ...form, assetName: e.target.value })}
                autoFocus
              />
            </FormField>
            <FormField label="Category" required>
              <select
                required
                className="input"
                value={form.categoryId}
                onChange={(e) => onCategoryChange(e.target.value)}
              >
                <option value="">Category…</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.categoryName}</option>
                ))}
              </select>
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Purchase date" required>
              <input
                required
                type="date"
                className="input"
                value={form.purchaseDate}
                onChange={(e) => setForm({ ...form, purchaseDate: e.target.value })}
              />
            </FormField>
            <FormField label="Purchase price" required>
              <input
                required
                type="number"
                step="any"
                min={0.01}
                className="input"
                value={form.purchasePrice}
                onChange={(e) => setForm({ ...form, purchasePrice: Number(e.target.value) })}
              />
            </FormField>
            <FormField label="Salvage value">
              <input
                type="number"
                step="any"
                min={0}
                className="input"
                value={form.salvageValue}
                onChange={(e) => setForm({ ...form, salvageValue: Number(e.target.value) })}
              />
            </FormField>
            <FormField label="Life (months)" required>
              <input
                required
                type="number"
                min={1}
                className="input"
                value={form.usefulLifeMonths}
                onChange={(e) => setForm({ ...form, usefulLifeMonths: Number(e.target.value) })}
              />
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Depreciation method">
              <select
                className="input"
                value={form.depreciationMethod}
                onChange={(e) =>
                  setForm({ ...form, depreciationMethod: e.target.value as "Straight Line" | "WDV" })
                }
              >
                <option>Straight Line</option>
                <option>WDV</option>
              </select>
            </FormField>
            <FormField label="WDV annual rate %" hint="Optional; auto-derives if blank">
              <input
                type="number"
                step="any"
                min={0}
                max={100}
                disabled={form.depreciationMethod !== "WDV"}
                className="input disabled:bg-surface-sunken"
                value={form.wdvAnnualRatePct}
                onChange={(e) => setForm({ ...form, wdvAnnualRatePct: Number(e.target.value) })}
              />
            </FormField>
          </div>
          <FormField label="Location">
            <input
              className="input"
              placeholder="Optional"
              value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
            />
          </FormField>
          <FormField label="Notes">
            <textarea
              className="input"
              rows={3}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </FormField>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </>
  );
}
