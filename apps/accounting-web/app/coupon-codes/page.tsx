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
  dateShort,
  type Column,
} from "../../components/ui";
import { Icon } from "../../components/app-shell";

interface RuleLite { id: string; title: string; ruleType: string }
interface Coupon {
  id: string;
  code: string;
  pricingRuleId: string;
  maxUses: number | null;
  usedCount: number;
  validFrom: string | null;
  validUpto: string | null;
  disabled: boolean;
  pricingRule: { title: string; ruleType: string };
}

const empty = {
  code: "",
  pricingRuleId: "",
  maxUses: "" as string | number,
  validFrom: "",
  validUpto: "",
  disabled: false,
};

type StatusFilter = "all" | "Active" | "Disabled" | "Redeemed" | "OutOfWindow";

function computeStatus(c: Coupon): "Active" | "Disabled" | "Redeemed" | "OutOfWindow" {
  const now = Date.now();
  const inWindow =
    (!c.validFrom || new Date(c.validFrom).getTime() <= now) &&
    (!c.validUpto || new Date(c.validUpto).getTime() >= now);
  const exhausted = c.maxUses != null && c.usedCount >= c.maxUses;
  if (c.disabled) return "Disabled";
  if (exhausted) return "Redeemed";
  if (!inWindow) return "OutOfWindow";
  return "Active";
}

export default function CouponCodesPage() {
  const [rows, setRows] = useState<Coupon[]>([]);
  const [rules, setRules] = useState<RuleLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  async function load() {
    setLoading(true);
    try {
      setRows(await api.get<Coupon[]>("/coupon-codes"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    api.get<RuleLite[]>("/pricing-rules").then(setRules).catch(() => {});
  }, []);

  useListPageCommands({
    singular: "Coupon Code",
    plural: "Coupon Codes",
    refresh: load,
  });
  function edit(c: Coupon, e: React.MouseEvent) {
    e.stopPropagation();
    setForm({
      code: c.code,
      pricingRuleId: c.pricingRuleId,
      maxUses: c.maxUses ?? "",
      validFrom: c.validFrom ? c.validFrom.slice(0, 10) : "",
      validUpto: c.validUpto ? c.validUpto.slice(0, 10) : "",
      disabled: c.disabled,
    });
    setEditingId(c.id);
    setShowForm(true);
  }

  function close() {
    setForm(empty);
    setEditingId(null);
    setShowForm(false);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const body = {
        ...form,
        maxUses: form.maxUses === "" ? null : Number(form.maxUses),
        validFrom: form.validFrom ? new Date(form.validFrom).toISOString() : null,
        validUpto: form.validUpto ? new Date(form.validUpto).toISOString() : null,
      };
      if (editingId) await api.put(`/coupon-codes/${editingId}`, body);
      else await api.post("/coupon-codes", body);
      close();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    }
  }

  async function remove(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm("Delete this coupon?")) return;
    try {
      await api.del(`/coupon-codes/${id}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((c) => {
      if (statusFilter !== "all" && computeStatus(c) !== statusFilter) return false;
      if (q && !`${c.code} ${c.pricingRule.title}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, search, statusFilter]);

  const counts = useMemo(() => {
    const c = { all: rows.length, Active: 0, Disabled: 0, Redeemed: 0, OutOfWindow: 0 };
    for (const r of rows) c[computeStatus(r)]++;
    return c;
  }, [rows]);

  const columns: Column<Coupon>[] = [
    {
      header: "Code",
      cell: (c) => (
        <span className="font-mono font-semibold text-ink">{c.code}</span>
      ),
    },
    {
      header: "Rule",
      cell: (c) => (
        <span className="text-xs text-ink">
          {c.pricingRule.title}
          <span className="text-ink-muted ms-1">({c.pricingRule.ruleType})</span>
        </span>
      ),
    },
    {
      header: "Usage",
      align: "right",
      cell: (c) => (
        <span className="tabular-nums text-xs text-ink-soft">
          {c.usedCount}
          {c.maxUses != null ? ` / ${c.maxUses}` : ""}
        </span>
      ),
    },
    {
      header: "Valid",
      cell: (c) => (
        <span className="text-xs text-ink-soft">
          {c.validFrom ? dateShort(c.validFrom) : "—"} → {c.validUpto ? dateShort(c.validUpto) : "∞"}
        </span>
      ),
    },
    {
      header: "Status",
      cell: (c) => {
        const st = computeStatus(c);
        const cls =
          st === "Active" ? "badge-green"
          : st === "Redeemed" ? "badge-blue"
          : st === "OutOfWindow" ? "badge-amber"
          : "badge-gray";
        const label = st === "OutOfWindow" ? "Out of window" : st;
        return <span className={cls}>{label}</span>;
      },
    },
    {
      header: "",
      align: "right",
      cell: (c) => (
        <div className="flex items-center justify-end gap-2">
          <button onClick={(e) => edit(c, e)} className="btn-ghost btn-sm">Edit</button>
          <button onClick={(e) => remove(c.id, e)} className="btn-ghost btn-sm text-red-600">Delete</button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Coupon Codes"
        subtitle={`${counts.Active} active · ${rows.length} total coupon${rows.length === 1 ? "" : "s"}`}
        actions={
          <Button variant="brand" onClick={() => setShowForm(true)}>+ New coupon</Button>
        }
      />

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}

      <div className="space-y-4">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search code or rule…" }}
          filters={
            <Segmented
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: "all",         label: "All",         count: counts.all },
                { value: "Active",      label: "Active",      count: counts.Active },
                { value: "OutOfWindow", label: "Out of window", count: counts.OutOfWindow },
                { value: "Redeemed",    label: "Redeemed",    count: counts.Redeemed },
                { value: "Disabled",    label: "Disabled",    count: counts.Disabled },
              ]}
        />
          }
          actions={<SavedViewsControls listKey="accounting-web:coupon-codes" current={{ search, statusFilter }} onApply={(fv) => { setSearch(fv.search); setStatusFilter(fv.statusFilter); }} />}
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(c) => c.id}
          loading={loading}
          empty={{
            icon: Icon.tag,
            title: search || statusFilter !== "all" ? "No matching coupons" : "No coupons yet",
            description: search || statusFilter !== "all"
              ? "Try changing your search or filter."
              : "Create a coupon code that links to a pricing rule.",
            action: !search && statusFilter === "all" && (
              <Button variant="brand" onClick={() => setShowForm(true)}>+ Add coupon</Button>
            ),
          }}
        />
      </div>

      <Drawer
        open={showForm}
        onClose={close}
        title={editingId ? "Edit coupon" : "New coupon"}
        footer={
          <>
            <Button variant="secondary" onClick={close}>Cancel</Button>
            <Button variant="brand" onClick={(e) => save(e as unknown as React.FormEvent)}>
              {editingId ? "Save changes" : "Create coupon"}
            </Button>
          </>
        }
      >
        <form onSubmit={save} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Code" required>
              <input
                required
                className="input font-mono uppercase"
                placeholder="SUMMER25"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                autoFocus
              />
            </FormField>
            <FormField label="Pricing rule" required>
              <select
                required
                className="input"
                value={form.pricingRuleId}
                onChange={(e) => setForm({ ...form, pricingRuleId: e.target.value })}
              >
                <option value="">Pricing rule…</option>
                {rules.map((r) => (
                  <option key={r.id} value={r.id}>{r.title} ({r.ruleType})</option>
                ))}
              </select>
            </FormField>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <FormField label="Max uses" hint="Blank = ∞">
              <input
                type="number"
                min={1}
                className="input"
                value={form.maxUses}
                onChange={(e) => setForm({ ...form, maxUses: e.target.value })}
              />
            </FormField>
            <FormField label="Valid from">
              <input
                type="date"
                className="input"
                value={form.validFrom}
                onChange={(e) => setForm({ ...form, validFrom: e.target.value })}
              />
            </FormField>
            <FormField label="Valid upto">
              <input
                type="date"
                className="input"
                value={form.validUpto}
                onChange={(e) => setForm({ ...form, validUpto: e.target.value })}
              />
            </FormField>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.disabled}
              onChange={(e) => setForm({ ...form, disabled: e.target.checked })}
            />
            Disabled
          </label>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </>
  );
}
