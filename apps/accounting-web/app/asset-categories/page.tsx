"use client";

import { useEffect, useMemo, useState } from "react";
import { useListPageCommands } from "@lumaara/web-ui";
import { api } from "../../lib/api";
import {
  Button,
  Card,
  DataTable,
  FormField,
  PageHeader,
  type Column,
} from "../../components/ui";

interface Account {
  id: string;
  accountName: string;
  rootType: string;
  isGroup: boolean;
}
interface Category {
  id: string;
  categoryName: string;
  defaultUsefulLifeMonths: number;
  assetAccount: { id: string; accountName: string };
  accumDepreciationAccount: { id: string; accountName: string };
  depExpenseAccount: { id: string; accountName: string };
  _count: { assets: number };
}

const emptyForm = {
  categoryName: "",
  assetAccountId: "",
  accumDepreciationAccountId: "",
  depExpenseAccountId: "",
  defaultUsefulLifeMonths: 36,
};

export default function AssetCategoriesPage() {
  const [rows, setRows] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [cs, accs] = await Promise.all([
        api.get<Category[]>("/asset-categories"),
        api.get<Account[]>("/accounts"),
      ]);
      setRows(cs);
      setAccounts(accs.filter((a) => !a.isGroup));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => {
    load();
  }, []);

  useListPageCommands({
    singular: "Asset Category",
    plural: "Asset Categories",
    refresh: load,
  });

  const assetOptions = useMemo(
    () => accounts.filter((a) => a.rootType === "Asset"),
    [accounts],
  );
  const expenseOptions = useMemo(
    () => accounts.filter((a) => a.rootType === "Expense"),
    [accounts],
  );

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await api.post("/asset-categories", form);
      setForm(emptyForm);
      setShowForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const cols: Column<Category>[] = [
    { header: "Category", cell: (c) => <span className="font-medium">{c.categoryName}</span> },
    { header: "Asset account", cell: (c) => <span className="text-xs">{c.assetAccount.accountName}</span> },
    { header: "Accum. Dep.", cell: (c) => <span className="text-xs">{c.accumDepreciationAccount.accountName}</span> },
    { header: "Dep. Expense", cell: (c) => <span className="text-xs">{c.depExpenseAccount.accountName}</span> },
    { header: "Life", align: "right", cell: (c) => <span className="tabular-nums">{c.defaultUsefulLifeMonths} mo</span> },
    { header: "Assets", align: "right", cell: (c) => <span className="tabular-nums">{c._count.assets}</span> },
  ];

  return (
    <main className="p-8 space-y-4 max-w-5xl">
      <PageHeader
        breadcrumb={[
          { label: "Home", href: "/" },
          { label: "Asset Categories" },
        ]}
        title="Asset Categories"
        subtitle="A category bundles the 3 accounts every asset in it posts to: Fixed Asset account (debited on acquisition), Accumulated Depreciation (credited each month), Depreciation Expense (debited each month)."
        actions={
          <Button variant="primary" onClick={() => setShowForm((s) => !s)} type="button">
            {showForm ? "Cancel" : "+ New Category"}
          </Button>
        }
      />

      {error && (
        <Card className="p-3 text-red-700 border-red-200 bg-red-50 text-sm">{error}</Card>
      )}

      {showForm && (
        <Card className="p-4 max-w-2xl">
          <form onSubmit={create} className="space-y-3">
            <FormField label="Category name" required>
              <input
                required
                className="input"
                placeholder="e.g. Equipment, Furniture, Vehicles"
                value={form.categoryName}
                onChange={(e) => setForm({ ...form, categoryName: e.target.value })}
              />
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Asset account (DR on acquire)" required>
                <select
                  required
                  className="input"
                  value={form.assetAccountId}
                  onChange={(e) => setForm({ ...form, assetAccountId: e.target.value })}
                >
                  <option value="">Select...</option>
                  {assetOptions.map((a) => (
                    <option key={a.id} value={a.id}>{a.accountName}</option>
                  ))}
                </select>
              </FormField>
              <FormField label="Accum. Depreciation (CR each month)" required>
                <select
                  required
                  className="input"
                  value={form.accumDepreciationAccountId}
                  onChange={(e) =>
                    setForm({ ...form, accumDepreciationAccountId: e.target.value })
                  }
                >
                  <option value="">Select...</option>
                  {assetOptions.map((a) => (
                    <option key={a.id} value={a.id}>{a.accountName}</option>
                  ))}
                </select>
              </FormField>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Depreciation Expense (DR each month)" required>
                <select
                  required
                  className="input"
                  value={form.depExpenseAccountId}
                  onChange={(e) => setForm({ ...form, depExpenseAccountId: e.target.value })}
                >
                  <option value="">Select...</option>
                  {expenseOptions.map((a) => (
                    <option key={a.id} value={a.id}>{a.accountName}</option>
                  ))}
                </select>
              </FormField>
              <FormField label="Default useful life (months)" required>
                <input
                  type="number"
                  min={1}
                  required
                  className="input tabular-nums"
                  value={form.defaultUsefulLifeMonths}
                  onChange={(e) =>
                    setForm({ ...form, defaultUsefulLifeMonths: Number(e.target.value) })
                  }
                />
              </FormField>
            </div>
            <Button variant="primary" type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </form>
        </Card>
      )}

      <DataTable<Category>
        columns={cols}
        rows={rows}
        rowKey={(c) => c.id}
        empty={{ title: "No categories yet" }}
      />
    </main>
  );
}
