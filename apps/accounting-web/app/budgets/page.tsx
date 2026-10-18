"use client";

import { useEffect, useMemo, useState } from "react";
import { useListPageCommands, SavedViewsControls } from "@lumaara/web-ui";
import { api } from "../../lib/api";
import {
  Button,
  Card,
  DataTable,
  Drawer,
  FilterBar,
  FormField,
  PageHeader,
  SectionHeader,
  Toast,
  money,
  type Column,
} from "../../components/ui";
import { Icon } from "../../components/app-shell";

interface Account {
  id: string;
  accountName: string;
  rootType: string;
  isGroup: boolean;
}
interface FiscalYear {
  id: string;
  name: string;
}
interface Budget {
  id: string;
  annualAmount: string;
  notes: string | null;
  fiscalYear: FiscalYear;
  account: { id: string; accountName: string; rootType: string };
}

interface VarianceRow {
  id: string;
  account: { id: string; accountName: string; rootType: string };
  budget: number;
  actual: number;
  variance: number;
  variancePct: number;
}
interface Variance {
  fiscalYear: { id: string; name: string; startDate: string; endDate: string };
  rows: VarianceRow[];
  totals: { budget: number; actual: number; variance: number };
}

export default function BudgetsPage() {
  const [rows, setRows] = useState<Budget[]>([]);
  const [fiscalYears, setFiscalYears] = useState<FiscalYear[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedFY, setSelectedFY] = useState("");
  const [variance, setVariance] = useState<Variance | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    fiscalYearId: "",
    accountId: "",
    annualAmount: 0,
    notes: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  async function load() {
    setLoading(true);
    try {
      const [bs, fys, accs] = await Promise.all([
        api.get<Budget[]>(
          selectedFY ? `/budgets?fiscalYearId=${selectedFY}` : "/budgets",
        ),
        api.get<FiscalYear[]>("/fiscal-years"),
        api.get<Account[]>("/accounts"),
      ]);
      setRows(bs);
      setFiscalYears(fys);
      setAccounts(accs.filter((a) => !a.isGroup));
      if (!selectedFY && fys.length > 0) setSelectedFY(fys[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFY]);

  useListPageCommands({
    singular: "Budget",
    plural: "Budgets",
    refresh: load,
  });
  async function loadVariance(fyId: string) {
    setError(null);
    try {
      setVariance(await api.get<Variance>(`/budgets/variance/${fyId}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load variance");
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/budgets", form);
      setForm({ fiscalYearId: form.fiscalYearId, accountId: "", annualAmount: 0, notes: "" });
      setShowForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  async function del(b: Budget, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`Delete budget for ${b.account.accountName}?`)) return;
    try {
      await api.del(`/budgets/${b.id}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  const spendableAccounts = useMemo(
    () => accounts.filter((a) => a.rootType === "Expense" || a.rootType === "Income"),
    [accounts],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((b) =>
      `${b.account.accountName} ${b.fiscalYear.name}`.toLowerCase().includes(q),
    );
  }, [rows, search]);

  const totalBudget = useMemo(
    () => rows.reduce((s, b) => s + Number(b.annualAmount), 0),
    [rows],
  );

  const columns: Column<Budget>[] = [
    {
      header: "Account",
      cell: (b) => <span className="font-medium text-ink">{b.account.accountName}</span>,
    },
    {
      header: "Type",
      cell: (b) => (
        <span className={b.account.rootType === "Income" ? "badge-green" : "badge-blue"}>
          {b.account.rootType}
        </span>
      ),
    },
    { header: "Fiscal Year", cell: (b) => <span className="text-ink-soft">{b.fiscalYear.name}</span> },
    {
      header: "Annual Budget",
      align: "right",
      cell: (b) => (
        <span className="tabular-nums font-medium text-ink">
          {money(Number(b.annualAmount))}
        </span>
      ),
    },
    {
      header: "",
      align: "right",
      cell: (b) => (
        <button onClick={(e) => del(b, e)} className="btn-ghost btn-sm text-red-600">Delete</button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Budgets"
        subtitle={
          rows.length > 0
            ? `${money(totalBudget)} budgeted across ${rows.length} account${rows.length === 1 ? "" : "s"}`
            : "No budgets configured"
        }
        actions={
          <>
            {selectedFY && (
              <Button variant="secondary" onClick={() => loadVariance(selectedFY)}>
                Load variance
              </Button>
            )}
            <Button
              variant="brand"
              onClick={() => {
                setForm({ ...form, fiscalYearId: selectedFY });
                setShowForm(true);
              }}
            >
              + New budget
            </Button>
          </>
        }
      />

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}

      <div className="space-y-4">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search account or fiscal year…" }}
          filters={
            <div className="flex items-center gap-2">
              <label className="text-xs text-ink-muted">Fiscal year</label>
              <select
                className="input"
                value={selectedFY}
                onChange={(e) => {
                  setSelectedFY(e.target.value);
                  setVariance(null);
                }}
              >
                <option value="">(all)</option>
                {fiscalYears.map((fy) => (
                  <option key={fy.id} value={fy.id}>{fy.name}</option>
                ))}
              </select>
            </div>
          }
          actions={<SavedViewsControls listKey="accounting-web:budgets" current={{ search, selectedFY }} onApply={(fv) => { setSearch(fv.search); setSelectedFY(fv.selectedFY); }} />}
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(b) => b.id}
          loading={loading}
          empty={{
            icon: Icon.target,
            title: search ? "No matching budgets" : "No budgets yet",
            description: search
              ? "Try a different search term."
              : "Set an annual budget per Income/Expense account within a fiscal year.",
            action: !search && (
              <Button
                variant="brand"
                onClick={() => {
                  setForm({ ...form, fiscalYearId: selectedFY });
                  setShowForm(true);
                }}
              >
                + Add budget
              </Button>
            ),
          }}
        />

        {variance && (
          <Card className="p-4 space-y-3">
            <SectionHeader title={`Variance — ${variance.fiscalYear.name}`} />
            <div className="table-wrap overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th className="text-end">Budget</th>
                    <th className="text-end">Actual</th>
                    <th className="text-end">Variance</th>
                    <th className="text-end">%</th>
                  </tr>
                </thead>
                <tbody>
                  {variance.rows.map((r) => (
                    <tr key={r.id}>
                      <td>{r.account.accountName}</td>
                      <td className="text-end tabular-nums">{money(r.budget)}</td>
                      <td className="text-end tabular-nums">{money(r.actual)}</td>
                      <td
                        className={`text-end tabular-nums font-medium ${
                          r.variance > 0
                            ? r.account.rootType === "Income"
                              ? "text-green-700"
                              : "text-red-700"
                            : "text-ink"
                        }`}
                      >
                        {r.variance > 0 ? "+" : ""}
                        {money(r.variance)}
                      </td>
                      <td className="text-end text-xs">{r.variancePct.toFixed(1)}%</td>
                    </tr>
                  ))}
                  {variance.rows.length === 0 && (
                    <tr>
                      <td colSpan={5} className="p-6 text-center text-ink-muted">
                        No budgets defined for this fiscal year
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot className="bg-surface-sunken font-semibold">
                  <tr>
                    <td>Total</td>
                    <td className="text-end tabular-nums">{money(variance.totals.budget)}</td>
                    <td className="text-end tabular-nums">{money(variance.totals.actual)}</td>
                    <td className="text-end tabular-nums">
                      {variance.totals.variance > 0 ? "+" : ""}
                      {money(variance.totals.variance)}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>
        )}
      </div>

      <Drawer
        open={showForm}
        onClose={() => setShowForm(false)}
        title="New budget"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button variant="brand" onClick={(e) => create(e as unknown as React.FormEvent)}>
              Create budget
            </Button>
          </>
        }
      >
        <form onSubmit={create} className="space-y-4">
          <FormField label="Fiscal year" required>
            <select
              required
              className="input"
              value={form.fiscalYearId}
              onChange={(e) => setForm({ ...form, fiscalYearId: e.target.value })}
            >
              <option value="">Select fiscal year…</option>
              {fiscalYears.map((fy) => (
                <option key={fy.id} value={fy.id}>{fy.name}</option>
              ))}
            </select>
          </FormField>
          <FormField label="Account (Income/Expense)" required>
            <select
              required
              className="input"
              value={form.accountId}
              onChange={(e) => setForm({ ...form, accountId: e.target.value })}
            >
              <option value="">Select account…</option>
              {spendableAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.accountName} ({a.rootType})
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Annual amount" required>
            <input
              type="number"
              step="any"
              min={0}
              className="input"
              value={form.annualAmount}
              onChange={(e) => setForm({ ...form, annualAmount: Number(e.target.value) })}
              required
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
