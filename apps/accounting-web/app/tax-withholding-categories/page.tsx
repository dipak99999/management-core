"use client";

import { useEffect, useState } from "react";
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

// B13 admin. TDS category = section rate + threshold + Liability account.
// Suppliers get tagged with one of these; on payment, PE auto-computes TDS.

interface AccountLite {
  id: string;
  accountName: string;
  rootType: string;
  isGroup: boolean;
}
interface Category {
  id: string;
  name: string;
  rate: string;
  thresholdAmount: string;
  accountId: string;
  disabled: boolean;
  account?: { accountName: string };
}

const emptyForm = {
  name: "",
  rate: 0,
  thresholdAmount: 0,
  accountId: "",
  disabled: false,
};

export default function TaxWithholdingCategoriesPage() {
  const [rows, setRows] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<AccountLite[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setRows(await api.get<Category[]>("/tax-withholding-categories"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }
  useEffect(() => {
    load();
    api.get<AccountLite[]>("/accounts").then(setAccounts).catch(() => {});
  }, []);

  useListPageCommands({
    singular: "Tax Withholding Category",
    plural: "Tax Withholding Categories",
    refresh: load,
  });

  function edit(c: Category) {
    setForm({
      name: c.name,
      rate: Number(c.rate),
      thresholdAmount: Number(c.thresholdAmount),
      accountId: c.accountId,
      disabled: c.disabled,
    });
    setEditingId(c.id);
    setShowForm(true);
  }
  function cancel() {
    setForm(emptyForm);
    setEditingId(null);
    setShowForm(false);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const payload = { ...form };
      if (editingId) await api.put(`/tax-withholding-categories/${editingId}`, payload);
      else await api.post("/tax-withholding-categories", payload);
      cancel();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this TDS category?")) return;
    try {
      await api.del(`/tax-withholding-categories/${id}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    }
  }

  // Only leaf Liability accounts are valid TDS destinations (matches server-side check).
  const liabilityLeaves = accounts.filter(
    (a) => a.rootType === "Liability" && !a.isGroup,
  );

  const cols: Column<Category>[] = [
    { header: "Name", cell: (c) => <span className="font-medium">{c.name}</span> },
    {
      header: "Rate",
      align: "right",
      cell: (c) => <span className="tabular-nums">{Number(c.rate).toFixed(2)}%</span>,
    },
    {
      header: "Threshold",
      align: "right",
      cell: (c) => <span className="tabular-nums">{Number(c.thresholdAmount).toFixed(2)}</span>,
    },
    { header: "Account", cell: (c) => c.account?.accountName ?? "—" },
    {
      header: "Status",
      cell: (c) =>
        c.disabled ? (
          <span className="badge-gray">Disabled</span>
        ) : (
          <span className="badge-green">Active</span>
        ),
    },
    {
      header: "",
      align: "right",
      cell: (c) => (
        <span className="space-x-2 text-sm">
          <button className="text-brand-600" onClick={() => edit(c)}>Edit</button>
          <button className="text-red-600" onClick={() => remove(c.id)}>Delete</button>
        </span>
      ),
    },
  ];

  return (
    <main className="p-8 space-y-4">
      <PageHeader
        breadcrumb={[
          { label: "Home", href: "/" },
          { label: "TDS Categories" },
        ]}
        title="TDS Categories"
        actions={
          <Button
            variant="primary"
            onClick={() => (showForm ? cancel() : setShowForm(true))}
            type="button"
          >
            {showForm ? "Cancel" : "+ New Category"}
          </Button>
        }
      />

      {error && (
        <Card className="p-3 text-red-700 border-red-200 bg-red-50 text-sm">{error}</Card>
      )}

      {showForm && (
        <Card className="p-4 max-w-md">
          <form onSubmit={save} className="space-y-3">
            {editingId && <div className="text-xs text-ink-muted">Editing existing category</div>}
            <FormField label="Name" required>
              <input
                required
                className="input"
                placeholder="e.g. TDS 194C Contractor"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Rate (%)" required>
                <input
                  required
                  type="number"
                  min={0}
                  max={100}
                  step="any"
                  className="input tabular-nums"
                  value={form.rate}
                  onChange={(e) => setForm({ ...form, rate: Number(e.target.value) })}
                />
              </FormField>
              <FormField label="Threshold" hint="Payment ≤ this → no TDS">
                <input
                  type="number"
                  min={0}
                  step="any"
                  className="input tabular-nums"
                  value={form.thresholdAmount}
                  onChange={(e) => setForm({ ...form, thresholdAmount: Number(e.target.value) })}
                />
              </FormField>
            </div>
            <FormField label="TDS Payable account (Liability)" required>
              <select
                required
                className="input"
                value={form.accountId}
                onChange={(e) => setForm({ ...form, accountId: e.target.value })}
              >
                <option value="">Select account...</option>
                {liabilityLeaves.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.accountName}
                  </option>
                ))}
              </select>
            </FormField>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.disabled}
                onChange={(e) => setForm({ ...form, disabled: e.target.checked })}
              />
              Disabled
            </label>
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
        empty={{ title: "No TDS categories yet" }}
      />
    </main>
  );
}
