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

type Formula = "OnTimeDelivery" | "Fulfillment" | "ResponseRate";

interface Criterion {
  id?: string;
  formula: Formula;
  weight: number;
}

interface Scorecard {
  id: string;
  name: string;
  period: string;
  isActive: boolean;
  latestScore: string | null;
  latestStanding: string | null;
  latestScoredAsOf: string | null;
  supplier: { supplierName: string };
  criteria: { formula: string; weight: string }[];
  _count: { periods: number };
}

interface Supplier {
  id: string;
  supplierName: string;
}

const FORMULA_LABELS: Record<Formula, string> = {
  OnTimeDelivery: "On-time delivery",
  Fulfillment: "Fulfillment rate",
  ResponseRate: "RFQ response rate",
};

const DEFAULT_CRITERIA: Criterion[] = [
  { formula: "OnTimeDelivery", weight: 40 },
  { formula: "Fulfillment", weight: 40 },
  { formula: "ResponseRate", weight: 20 },
];

// Module 46 — Supplier scorecard list + edit.
//
// Rows show every scorecard's cached latest score + standing (colored)
// + period, so buyers can eyeball supplier quality at a glance. Row
// click opens an edit Drawer for the criteria weights + active flag.
// "Recompute" button per row triggers POST /:id/recompute for the last
// complete period; the scheduler tick handles the daily walk.
export default function SupplierScorecardsPage() {
  const [rows, setRows] = useState<Scorecard[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<{
    supplierId: string;
    name: string;
    period: "Monthly" | "Quarterly";
    isActive: boolean;
    criteria: Criterion[];
  }>({
    supplierId: "",
    name: "",
    period: "Monthly",
    isActive: true,
    criteria: DEFAULT_CRITERIA,
  });

  async function load() {
    setLoading(true);
    try {
      const [s, sup] = await Promise.all([
        api.get<Scorecard[]>("/supplier-scorecards"),
        api.get<Supplier[]>("/suppliers"),
      ]);
      setRows(s);
      setSuppliers(sup);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  useListPageCommands({
    singular: "Supplier Scorecard",
    plural: "Supplier Scorecards",
    refresh: load,
  });
  function openCreate() {
    setEditingId(null);
    setForm({
      supplierId: "",
      name: "",
      period: "Monthly",
      isActive: true,
      criteria: DEFAULT_CRITERIA,
    });
    setShowForm(true);
  }

  function openEdit(s: Scorecard) {
    setEditingId(s.id);
    setForm({
      supplierId: "",
      name: s.name,
      period: s.period as "Monthly" | "Quarterly",
      isActive: s.isActive,
      criteria: s.criteria.map((c) => ({
        formula: c.formula as Formula,
        weight: Number(c.weight),
      })),
    });
    setShowForm(true);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const totalWeight = form.criteria.reduce((s, c) => s + Number(c.weight), 0);
    if (totalWeight === 0) {
      setError("At least one criterion needs a non-zero weight");
      return;
    }
    setError(null);
    try {
      if (editingId) {
        await api.put(`/supplier-scorecards/${editingId}`, {
          name: form.name,
          period: form.period,
          isActive: form.isActive,
          criteria: form.criteria,
        });
      } else {
        if (!form.supplierId) {
          setError("Pick a supplier");
          return;
        }
        await api.post("/supplier-scorecards", {
          supplierId: form.supplierId,
          name: form.name || `${suppliers.find((s) => s.id === form.supplierId)?.supplierName ?? "Supplier"} scorecard`,
          period: form.period,
          isActive: form.isActive,
          criteria: form.criteria,
        });
      }
      setShowForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  async function recompute(s: Scorecard, e: React.MouseEvent) {
    e.stopPropagation();
    setError(null);
    setBusy(s.id);
    try {
      const r = await api.post<{ score: string; standing: string }>(
        `/supplier-scorecards/${s.id}/recompute`,
        {},
      );
      setInfo(`Recomputed ${s.supplier.supplierName}: ${Number(r.score).toFixed(1)} (${r.standing})`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Recompute failed");
    } finally {
      setBusy(null);
    }
  }

  async function removeCard(s: Scorecard, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`Delete ${s.supplier.supplierName}'s scorecard? Deletes all historic periods too. Not reversible.`)) return;
    try {
      await api.del(`/supplier-scorecards/${s.id}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) => r.name.toLowerCase().includes(q) || r.supplier.supplierName.toLowerCase().includes(q),
    );
  }, [rows, search]);

  function standingClass(s: string | null): string {
    if (s === "Very Good" || s === "Good") return "text-green-700";
    if (s === "Average") return "text-amber-700";
    if (s === "Poor" || s === "Very Poor") return "text-red-700";
    return "text-ink-muted";
  }

  const columns: Column<Scorecard>[] = [
    {
      header: "Supplier / Scorecard",
      cell: (s) => (
        <button onClick={() => openEdit(s)} className="text-start">
          <div className="font-medium text-ink">{s.supplier.supplierName}</div>
          <div className="text-xs text-ink-muted">{s.name}</div>
        </button>
      ),
    },
    { header: "Period", cell: (s) => <span className="text-sm">{s.period}</span> },
    {
      header: "Latest score",
      align: "right",
      cell: (s) =>
        s.latestScore !== null ? (
          <div className="text-end">
            <div className={`font-mono font-medium ${standingClass(s.latestStanding)}`}>
              {Number(s.latestScore).toFixed(1)}
            </div>
            <div className={`text-xs ${standingClass(s.latestStanding)}`}>{s.latestStanding}</div>
          </div>
        ) : (
          <span className="text-ink-muted italic text-sm">not scored yet</span>
        ),
    },
    {
      header: "As of",
      cell: (s) => (
        <span className="text-xs text-ink-muted">
          {s.latestScoredAsOf ? dateShort(s.latestScoredAsOf) : "—"}
        </span>
      ),
    },
    { header: "Periods", cell: (s) => <span className="text-xs">{s._count.periods}</span> },
    {
      header: "Status",
      cell: (s) =>
        s.isActive ? (
          <span className="badge-blue text-xs">Active</span>
        ) : (
          <span className="badge text-xs">Paused</span>
        ),
    },
    {
      header: "",
      align: "right",
      cell: (s) => (
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={(e) => recompute(s, e)}
            className="btn-ghost btn-sm"
            disabled={busy === s.id}
          >
            {busy === s.id ? "…" : "Recompute"}
          </button>
          <button onClick={(e) => removeCard(s, e)} className="btn-ghost btn-sm text-red-600">
            Delete
          </button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Supplier Scorecards"
        subtitle="Weighted supplier-quality scores rolled up from PO/PR/RFQ history. Surfaces in the RFQ compare view."
        actions={<Button variant="brand" onClick={openCreate}>+ New scorecard</Button>}
      />

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}
      {info && <div className="mb-4"><Toast kind="success" message={info} onDismiss={() => setInfo(null)} /></div>}

      <div className="space-y-4">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search supplier / scorecard…" }}
          actions={<SavedViewsControls listKey="buying-web:supplier-scorecards" current={{ search }} onApply={(fv) => setSearch(fv.search)} />}
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(s) => s.id}
          loading={loading}
          empty={{
            icon: Icon.bar,
            title: search ? "No matching scorecards" : "No scorecards yet",
            description: "Create a scorecard for a supplier to track their delivery, fulfillment, and RFQ response performance.",
            action: !search && <Button variant="brand" onClick={openCreate}>+ New scorecard</Button>,
          }}
        />
      </div>

      <Drawer
        open={showForm}
        onClose={() => setShowForm(false)}
        title={editingId ? "Edit scorecard" : "New supplier scorecard"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button variant="brand" onClick={(e) => submit(e as unknown as React.FormEvent)}>
              {editingId ? "Save" : "Create"}
            </Button>
          </>
        }
      >
        <form onSubmit={submit} className="space-y-4">
          {!editingId && (
            <FormField label="Supplier" required>
              <select
                className="input"
                value={form.supplierId}
                onChange={(e) => setForm({ ...form, supplierId: e.target.value })}
                required
              >
                <option value="">— pick supplier —</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.supplierName}
                  </option>
                ))}
              </select>
            </FormField>
          )}
          <FormField label="Scorecard name" hint="Auto-derived from supplier name if left blank">
            <input
              className="input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder={
                editingId
                  ? form.name
                  : `${suppliers.find((s) => s.id === form.supplierId)?.supplierName ?? "Supplier"} scorecard`
              }
            />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Period">
              <select
                className="input"
                value={form.period}
                onChange={(e) => setForm({ ...form, period: e.target.value as "Monthly" | "Quarterly" })}
              >
                <option value="Monthly">Monthly</option>
                <option value="Quarterly">Quarterly</option>
              </select>
            </FormField>
            <FormField label="Status">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                />
                Active (auto-recompute)
              </label>
            </FormField>
          </div>
          <FormField label="Weights (any total; renormalized to 100)">
            <div className="space-y-2">
              {form.criteria.map((c, idx) => (
                <div key={c.formula} className="flex items-center gap-3">
                  <span className="flex-1 text-sm">{FORMULA_LABELS[c.formula]}</span>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    max="100"
                    className="input w-24 text-end font-mono"
                    value={c.weight}
                    onChange={(e) => {
                      const next = [...form.criteria];
                      next[idx] = { ...c, weight: Number(e.target.value) };
                      setForm({ ...form, criteria: next });
                    }}
                  />
                </div>
              ))}
            </div>
          </FormField>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </>
  );
}
