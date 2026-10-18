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

interface Account { id: string; accountName: string; rootType: string; isGroup: boolean }
interface TemplateRow {
  id: string;
  description: string;
  rate: string;
  accountId: string;
  sortOrder: number;
  chargeType: string;
  amount: string;
  account?: { accountName: string; rootType: string };
}
type ChargeType = "On Net Total" | "On Previous Row Total" | "Actual";
const CHARGE_TYPES: ChargeType[] = ["On Net Total", "On Previous Row Total", "Actual"];
interface TaxTemplate {
  id: string;
  name: string;
  templateType: string;
  rate: string | null;
  isDefault: boolean;
  account: { accountName: string; rootType: string } | null;
  rows: TemplateRow[];
}

interface FormRow {
  description: string;
  rate: number;
  accountId: string;
  chargeType: ChargeType;
  amount: number;
}

const emptyRow = (): FormRow => ({
  description: "",
  rate: 0,
  accountId: "",
  chargeType: "On Net Total",
  amount: 0,
});

type TypeFilter = "all" | "Sales" | "Purchase";

export default function TaxTemplatesPage() {
  const [rows, setRows] = useState<TaxTemplate[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    templateType: "Sales" as "Sales" | "Purchase",
    isDefault: false,
    rows: [emptyRow()] as FormRow[],
  });
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");

  async function load() {
    setLoading(true);
    try {
      setRows(await api.get<TaxTemplate[]>("/tax-templates"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    api
      .get<Account[]>("/accounts")
      .then((all) => setAccounts(all.filter((a) => !a.isGroup)))
      .catch(() => {});
  }, []);

  useListPageCommands({
    singular: "Tax Template",
    plural: "Tax Templates",
    refresh: load,
  });
  function resetForm() {
    setForm({
      name: "",
      templateType: "Sales",
      isDefault: false,
      rows: [emptyRow()],
    });
    setEditingId(null);
  }

  function close() {
    resetForm();
    setShowForm(false);
  }

  function editTemplate(t: TaxTemplate, e: React.MouseEvent) {
    e.stopPropagation();
    setEditingId(t.id);
    const seeded: FormRow[] =
      t.rows.length > 0
        ? t.rows.map((r) => ({
            description: r.description,
            rate: Number(r.rate),
            accountId: r.accountId,
            chargeType: (r.chargeType as ChargeType) ?? "On Net Total",
            amount: Number(r.amount ?? 0),
          }))
        : t.rate != null
          ? [
              {
                description: `${t.name} @ ${Number(t.rate).toFixed(2)}%`,
                rate: Number(t.rate),
                accountId: accounts.find((a) => a.accountName === t.account?.accountName)?.id ?? "",
                chargeType: "On Net Total" as ChargeType,
                amount: 0,
              },
            ]
          : [emptyRow()];
    setForm({
      name: t.name,
      templateType: t.templateType as "Sales" | "Purchase",
      isDefault: t.isDefault,
      rows: seeded,
    });
    setShowForm(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    for (const r of form.rows) {
      if (!r.description.trim()) return setError("Every row needs a description");
      if (!r.accountId) return setError("Every row needs a tax account");
    }
    try {
      const body = {
        name: form.name,
        templateType: form.templateType,
        isDefault: form.isDefault,
        rows: form.rows.map((r, i) => ({
          description: r.description,
          rate: r.rate,
          accountId: r.accountId,
          sortOrder: i,
          chargeType: r.chargeType,
          amount: r.amount,
        })),
      };
      if (editingId) await api.put(`/tax-templates/${editingId}`, body);
      else await api.post("/tax-templates", body);
      close();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  async function del(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm("Delete this template?")) return;
    try {
      await api.del(`/tax-templates/${id}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  function updateRow(idx: number, patch: Partial<FormRow>) {
    setForm((f) => ({
      ...f,
      rows: f.rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
    }));
  }
  function addRow() {
    setForm((f) => ({ ...f, rows: [...f.rows, emptyRow()] }));
  }
  function removeRow(idx: number) {
    setForm((f) => ({
      ...f,
      rows: f.rows.length > 1 ? f.rows.filter((_, i) => i !== idx) : f.rows,
    }));
  }

  const totalRate = form.rows.reduce((s, r) => s + Number(r.rate), 0);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((t) => {
      if (typeFilter !== "all" && t.templateType !== typeFilter) return false;
      if (q && !t.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, search, typeFilter]);

  const counts = useMemo(() => ({
    all:      rows.length,
    Sales:    rows.filter((r) => r.templateType === "Sales").length,
    Purchase: rows.filter((r) => r.templateType === "Purchase").length,
  }), [rows]);

  const columns: Column<TaxTemplate>[] = [
    {
      header: "Name",
      cell: (t) => (
        <div className="flex items-center gap-2">
          <span className="font-medium text-ink">{t.name}</span>
          {t.isDefault && <span className="badge-brand">Default</span>}
        </div>
      ),
    },
    {
      header: "Type",
      cell: (t) => (
        <span className={t.templateType === "Sales" ? "badge-green" : "badge-blue"}>
          {t.templateType}
        </span>
      ),
    },
    {
      header: "Rows",
      cell: (t) => {
        const effRows =
          t.rows.length > 0
            ? t.rows
            : t.rate != null
              ? [
                  {
                    id: t.id,
                    description: `${t.name} @ ${Number(t.rate).toFixed(2)}%`,
                    rate: t.rate,
                    accountId: "",
                    sortOrder: 0,
                    account: t.account ?? undefined,
                  } as TemplateRow,
                ]
              : [];
        if (effRows.length === 0) {
          return <span className="text-red-600 text-xs">no rows</span>;
        }
        return (
          <ul className="space-y-0.5">
            {effRows.map((r) => (
              <li key={r.id} className="text-xs text-ink-soft">
                <span className="font-mono text-ink">{Number(r.rate).toFixed(2)}%</span>{" "}
                {r.description}
                {r.account && (
                  <span className="text-ink-muted"> → {r.account.accountName}</span>
                )}
              </li>
            ))}
          </ul>
        );
      },
    },
    {
      header: "Effective",
      align: "right",
      cell: (t) => {
        const effRows =
          t.rows.length > 0 ? t.rows : t.rate != null ? [{ rate: t.rate } as TemplateRow] : [];
        const effTotal = effRows.reduce((s, r) => s + Number(r.rate), 0);
        return (
          <span className="tabular-nums font-medium text-ink">{effTotal.toFixed(2)}%</span>
        );
      },
    },
    {
      header: "",
      align: "right",
      cell: (t) => (
        <div className="flex items-center justify-end gap-2">
          <button onClick={(e) => editTemplate(t, e)} className="btn-ghost btn-sm">Edit</button>
          <button onClick={(e) => del(t.id, e)} className="btn-ghost btn-sm text-red-600">Delete</button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Tax Templates"
        subtitle={`${rows.length} template${rows.length === 1 ? "" : "s"} · ${counts.Sales} sales · ${counts.Purchase} purchase`}
        actions={
          <Button variant="brand" onClick={() => setShowForm(true)}>+ New template</Button>
        }
      />

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}

      <div className="space-y-4">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search templates…" }}
          filters={
            <Segmented
              value={typeFilter}
              onChange={setTypeFilter}
              options={[
                { value: "all",      label: "All",      count: counts.all },
                { value: "Sales",    label: "Sales",    count: counts.Sales },
                { value: "Purchase", label: "Purchase", count: counts.Purchase },
              ]}
            />
          }
          actions={<SavedViewsControls listKey="accounting-web:tax-templates" current={{ search, typeFilter }} onApply={(fv) => { setSearch(fv.search); setTypeFilter(fv.typeFilter); }} />}
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(t) => t.id}
          loading={loading}
          empty={{
            icon: Icon.tag,
            title: search || typeFilter !== "all" ? "No matching templates" : "No tax templates yet",
            description: search || typeFilter !== "all"
              ? "Try changing your search or filter."
              : "Create your first tax template with one or more tax rows.",
            action: !search && typeFilter === "all" && (
              <Button variant="brand" onClick={() => setShowForm(true)}>+ Add template</Button>
            ),
          }}
        />
      </div>

      <Drawer
        open={showForm}
        onClose={close}
        title={editingId ? "Edit tax template" : "New tax template"}
        width="w-[860px]"
        footer={
          <>
            <Button variant="secondary" onClick={close}>Cancel</Button>
            <Button variant="brand" onClick={(e) => save(e as unknown as React.FormEvent)}>
              {editingId ? "Save changes" : "Create template"}
            </Button>
          </>
        }
      >
        <form onSubmit={save} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Template name" required>
              <input
                className="input"
                placeholder="e.g. GST 18% intra-state"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
                autoFocus
              />
            </FormField>
            <FormField label="Type">
              <select
                className="input"
                value={form.templateType}
                onChange={(e) =>
                  setForm({ ...form, templateType: e.target.value as "Sales" | "Purchase" })
                }
              >
                <option>Sales</option>
                <option>Purchase</option>
              </select>
            </FormField>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
                Tax rows
              </div>
              <button
                type="button"
                onClick={addRow}
                className="text-xs text-brand-600 hover:text-brand-700"
              >
                + Add row
              </button>
            </div>
            <div className="table-wrap overflow-x-auto">
              <table className="table text-sm">
                <thead>
                  <tr>
                    <th>Description</th>
                    <th className="w-40">Charge type</th>
                    <th className="w-20 text-end">Rate %</th>
                    <th className="w-24 text-end">Actual amt</th>
                    <th>Account</th>
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {form.rows.map((r, i) => (
                    <tr key={i}>
                      <td>
                        <input
                          required
                          className="input"
                          placeholder="e.g. CGST"
                          value={r.description}
                          onChange={(e) => updateRow(i, { description: e.target.value })}
                        />
                      </td>
                      <td>
                        <select
                          className="input"
                          value={r.chargeType}
                          onChange={(e) =>
                            updateRow(i, { chargeType: e.target.value as ChargeType })
                          }
                        >
                          {CHARGE_TYPES.map((ct) => (
                            <option key={ct} value={ct}>{ct}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          type="number"
                          step="any"
                          min={0}
                          max={100}
                          disabled={r.chargeType === "Actual"}
                          className="input text-end disabled:bg-surface-sunken"
                          value={r.rate}
                          onChange={(e) => updateRow(i, { rate: Number(e.target.value) })}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          step="any"
                          min={0}
                          disabled={r.chargeType !== "Actual"}
                          className="input text-end disabled:bg-surface-sunken"
                          value={r.amount}
                          onChange={(e) => updateRow(i, { amount: Number(e.target.value) })}
                        />
                      </td>
                      <td>
                        <select
                          required
                          className="input"
                          value={r.accountId}
                          onChange={(e) => updateRow(i, { accountId: e.target.value })}
                        >
                          <option value="">Select account…</option>
                          {accounts.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.accountName} ({a.rootType})
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="text-center">
                        <button
                          type="button"
                          disabled={form.rows.length === 1}
                          onClick={() => removeRow(i)}
                          className="text-red-600 disabled:text-ink-muted/40 text-xs"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="text-xs text-ink-muted mt-2 text-end">
              Effective total: <b className="text-ink">{totalRate.toFixed(2)}%</b>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isDefault}
              onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
            />
            Default for {form.templateType} invoices
          </label>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </>
  );
}
