"use client";

import { useEffect, useMemo, useState } from "react";
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

interface Rule {
  id: string;
  title: string;
  applyOn: string;
  itemId: string | null;
  customerId: string | null;
  customerGroupId: string | null;
  territoryId: string | null;
  minQty: string;
  maxQty: string | null;
  ruleType: string;
  discountPercent: string;
  ratePrice: string;
  priority: number;
  validFrom: string | null;
  validUpto: string | null;
  disabled: boolean;
}
interface Lite { id: string; label: string }

const empty = {
  title: "",
  applyOn: "Selling" as "Selling" | "Buying",
  itemId: "",
  customerId: "",
  customerGroupId: "",
  territoryId: "",
  minQty: 0,
  maxQty: "" as string | number,
  ruleType: "Discount %" as "Discount %" | "Rate",
  discountPercent: 0,
  ratePrice: 0,
  priority: 0,
  validFrom: "",
  validUpto: "",
  disabled: false,
};

type ApplyFilter = "all" | "Selling" | "Buying";

export default function PricingRulesPage() {
  const [rows, setRows] = useState<Rule[]>([]);
  const [items, setItems] = useState<Lite[]>([]);
  const [customers, setCustomers] = useState<Lite[]>([]);
  const [groups, setGroups] = useState<Lite[]>([]);
  const [territories, setTerritories] = useState<Lite[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(empty);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [applyFilter, setApplyFilter] = useState<ApplyFilter>("all");

  async function load() {
    setLoading(true);
    try {
      setRows(await api.get<Rule[]>("/pricing-rules"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    api
      .get<{ id: string; itemCode: string; itemName: string }[]>("/items")
      .then((rs) => setItems(rs.map((r) => ({ id: r.id, label: `${r.itemCode} — ${r.itemName}` }))))
      .catch(() => {});
    api
      .get<{ id: string; customerName: string }[]>("/customers")
      .then((rs) => setCustomers(rs.map((r) => ({ id: r.id, label: r.customerName }))))
      .catch(() => {});
    api
      .get<{ id: string; groupName: string }[]>("/customer-groups")
      .then((rs) => setGroups(rs.map((r) => ({ id: r.id, label: r.groupName }))))
      .catch(() => {});
    api
      .get<{ id: string; territoryName: string }[]>("/territories")
      .then((rs) => setTerritories(rs.map((r) => ({ id: r.id, label: r.territoryName }))))
      .catch(() => {});
  }, []);

  function edit(r: Rule, e: React.MouseEvent) {
    e.stopPropagation();
    setForm({
      title: r.title,
      applyOn: r.applyOn as "Selling" | "Buying",
      itemId: r.itemId ?? "",
      customerId: r.customerId ?? "",
      customerGroupId: r.customerGroupId ?? "",
      territoryId: r.territoryId ?? "",
      minQty: Number(r.minQty),
      maxQty: r.maxQty != null ? Number(r.maxQty) : "",
      ruleType: r.ruleType as "Discount %" | "Rate",
      discountPercent: Number(r.discountPercent),
      ratePrice: Number(r.ratePrice),
      priority: r.priority,
      validFrom: r.validFrom ? r.validFrom.slice(0, 10) : "",
      validUpto: r.validUpto ? r.validUpto.slice(0, 10) : "",
      disabled: r.disabled,
    });
    setEditingId(r.id);
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
        itemId: form.itemId || null,
        customerId: form.customerId || null,
        customerGroupId: form.customerGroupId || null,
        territoryId: form.territoryId || null,
        maxQty: form.maxQty === "" ? null : Number(form.maxQty),
        validFrom: form.validFrom ? new Date(form.validFrom).toISOString() : null,
        validUpto: form.validUpto ? new Date(form.validUpto).toISOString() : null,
      };
      if (editingId) await api.put(`/pricing-rules/${editingId}`, body);
      else await api.post("/pricing-rules", body);
      close();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    }
  }

  async function remove(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm("Delete this rule?")) return;
    try {
      await api.del(`/pricing-rules/${id}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (applyFilter !== "all" && r.applyOn !== applyFilter) return false;
      if (q && !r.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, search, applyFilter]);

  const counts = useMemo(() => ({
    all:     rows.length,
    Selling: rows.filter((r) => r.applyOn === "Selling").length,
    Buying:  rows.filter((r) => r.applyOn === "Buying").length,
  }), [rows]);

  const activeCount = useMemo(() => rows.filter((r) => !r.disabled).length, [rows]);

  const columns: Column<Rule>[] = [
    {
      header: "Title",
      cell: (r) => (
        <div className={r.disabled ? "text-ink-muted" : "text-ink"}>
          <span className="font-medium">{r.title}</span>
          {r.disabled && <span className="ms-2 badge-gray">disabled</span>}
        </div>
      ),
    },
    {
      header: "Apply on",
      cell: (r) => (
        <span className={r.applyOn === "Selling" ? "badge-green" : "badge-blue"}>
          {r.applyOn}
        </span>
      ),
    },
    {
      header: "Scope",
      cell: (r) => (
        <span className="text-xs text-ink-soft">
          {[
            r.itemId && "item",
            r.customerId && "customer",
            r.customerGroupId && "group",
            r.territoryId && "territory",
            Number(r.minQty) > 0 && `qty≥${r.minQty}`,
            r.maxQty && `qty≤${r.maxQty}`,
          ]
            .filter(Boolean)
            .join(" · ") || "any"}
        </span>
      ),
    },
    {
      header: "Effect",
      align: "right",
      cell: (r) => (
        <span className="text-xs tabular-nums font-medium text-ink">
          {r.ruleType === "Rate"
            ? `Rate = ${Number(r.ratePrice).toFixed(2)}`
            : `−${Number(r.discountPercent).toFixed(2)}%`}
        </span>
      ),
    },
    {
      header: "Priority",
      align: "right",
      cell: (r) => <span className="tabular-nums text-ink-soft">{r.priority}</span>,
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
        title="Pricing Rules"
        subtitle={`${activeCount} active · ${rows.length} total rule${rows.length === 1 ? "" : "s"}`}
        actions={
          <Button variant="brand" onClick={() => setShowForm(true)}>+ New rule</Button>
        }
      />

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}

      <div className="space-y-4">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search by title…" }}
          filters={
            <Segmented
              value={applyFilter}
              onChange={setApplyFilter}
              options={[
                { value: "all",     label: "All",     count: counts.all },
                { value: "Selling", label: "Selling", count: counts.Selling },
                { value: "Buying",  label: "Buying",  count: counts.Buying },
              ]}
            />
          }
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.id}
          loading={loading}
          empty={{
            icon: Icon.tag,
            title: search || applyFilter !== "all" ? "No matching rules" : "No pricing rules yet",
            description: search || applyFilter !== "all"
              ? "Try changing your search or filter."
              : "Add your first pricing rule to automate discounts.",
            action: !search && applyFilter === "all" && (
              <Button variant="brand" onClick={() => setShowForm(true)}>+ Add rule</Button>
            ),
          }}
        />
      </div>

      <Drawer
        open={showForm}
        onClose={close}
        title={editingId ? "Edit pricing rule" : "New pricing rule"}
        width="w-[720px]"
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
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <FormField label="Title" required>
                <input
                  required
                  className="input"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  autoFocus
                />
              </FormField>
            </div>
            <FormField label="Apply on">
              <select
                className="input"
                value={form.applyOn}
                onChange={(e) => setForm({ ...form, applyOn: e.target.value as "Selling" | "Buying" })}
              >
                <option>Selling</option>
                <option>Buying</option>
              </select>
            </FormField>
          </div>

          <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
            Match filters — all optional, all must match
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Item">
              <select
                className="input"
                value={form.itemId}
                onChange={(e) => setForm({ ...form, itemId: e.target.value })}
              >
                <option value="">Any item</option>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>{i.label}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Customer">
              <select
                className="input"
                value={form.customerId}
                onChange={(e) => setForm({ ...form, customerId: e.target.value })}
              >
                <option value="">Any customer</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Customer group">
              <select
                className="input"
                value={form.customerGroupId}
                onChange={(e) => setForm({ ...form, customerGroupId: e.target.value })}
              >
                <option value="">Any customer group</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>{g.label}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Territory">
              <select
                className="input"
                value={form.territoryId}
                onChange={(e) => setForm({ ...form, territoryId: e.target.value })}
              >
                <option value="">Any territory</option>
                {territories.map((t) => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </select>
            </FormField>
          </div>

          <div className="grid grid-cols-4 gap-3">
            <FormField label="Min qty">
              <input
                type="number"
                min={0}
                step="any"
                className="input"
                value={form.minQty}
                onChange={(e) => setForm({ ...form, minQty: Number(e.target.value) })}
              />
            </FormField>
            <FormField label="Max qty" hint="Blank = ∞">
              <input
                type="number"
                min={0}
                step="any"
                className="input"
                value={form.maxQty}
                onChange={(e) => setForm({ ...form, maxQty: e.target.value })}
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

          <div className="grid grid-cols-3 gap-3">
            <FormField label="Rule type">
              <select
                className="input"
                value={form.ruleType}
                onChange={(e) => setForm({ ...form, ruleType: e.target.value as "Discount %" | "Rate" })}
              >
                <option>Discount %</option>
                <option>Rate</option>
              </select>
            </FormField>
            {form.ruleType === "Discount %" ? (
              <FormField label="Discount %">
                <input
                  type="number"
                  min={0}
                  max={100}
                  step="any"
                  className="input"
                  value={form.discountPercent}
                  onChange={(e) => setForm({ ...form, discountPercent: Number(e.target.value) })}
                />
              </FormField>
            ) : (
              <FormField label="Rate">
                <input
                  type="number"
                  min={0}
                  step="any"
                  className="input"
                  value={form.ratePrice}
                  onChange={(e) => setForm({ ...form, ratePrice: Number(e.target.value) })}
                />
              </FormField>
            )}
            <FormField label="Priority">
              <input
                type="number"
                className="input"
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}
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
