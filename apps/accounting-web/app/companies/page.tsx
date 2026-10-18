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

interface Company {
  id: string;
  name: string;
  code: string;
  gstin: string | null;
  homeStateCode: string | null;
  pan: string | null;
  baseCurrency: string;
  isDefault: boolean;
  disabled: boolean;
  defaultReceivableAccountId: string | null;
  defaultPayableAccountId: string | null;
  defaultCashAccountId: string | null;
  defaultBankAccountId: string | null;
  defaultIncomeAccountId: string | null;
  defaultExpenseAccountId: string | null;
  defaultRoundOffAccountId: string | null;
  defaultFxGainLossAccountId: string | null;
}

interface Account {
  id: string;
  accountName: string;
  accountType: string | null;
  rootType: string;
  isGroup: boolean;
}

const emptyForm = {
  name: "",
  code: "",
  gstin: "",
  baseCurrency: "INR",
  isDefault: false,
  defaultReceivableAccountId: "",
  defaultPayableAccountId: "",
  defaultCashAccountId: "",
  defaultBankAccountId: "",
  defaultIncomeAccountId: "",
  defaultExpenseAccountId: "",
  defaultRoundOffAccountId: "",
  defaultFxGainLossAccountId: "",
};

// Multi-company Phase 5 admin surface. Handles Company CRUD + the two
// one-shot ops (clone CoA, backfill legacy) that admins need to run
// after Phase 2 rollout. Kept as a single page rather than a wizard —
// admins usually know what they need, and the ops are individually
// reversible (or safely idempotent).
export default function CompaniesPage() {
  const [rows, setRows] = useState<Company[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");

  async function load() {
    setLoading(true);
    try {
      const [co, acc] = await Promise.all([
        api.get<Company[]>("/companies"),
        api.get<Account[]>("/accounts"),
      ]);
      setRows(co);
      setAccounts(acc);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  useListPageCommands({
    singular: "Company",
    plural: "Companies",
    refresh: load,
  });
  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(true);
  }
  function openEdit(c: Company) {
    setEditingId(c.id);
    setForm({
      name: c.name,
      code: c.code,
      gstin: c.gstin ?? "",
      baseCurrency: c.baseCurrency,
      isDefault: c.isDefault,
      defaultReceivableAccountId: c.defaultReceivableAccountId ?? "",
      defaultPayableAccountId: c.defaultPayableAccountId ?? "",
      defaultCashAccountId: c.defaultCashAccountId ?? "",
      defaultBankAccountId: c.defaultBankAccountId ?? "",
      defaultIncomeAccountId: c.defaultIncomeAccountId ?? "",
      defaultExpenseAccountId: c.defaultExpenseAccountId ?? "",
      defaultRoundOffAccountId: c.defaultRoundOffAccountId ?? "",
      defaultFxGainLossAccountId: c.defaultFxGainLossAccountId ?? "",
    });
    setShowForm(true);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const payload = {
        name: form.name,
        code: form.code,
        gstin: form.gstin || null,
        baseCurrency: form.baseCurrency,
        isDefault: form.isDefault,
        // null → clear override; "" → also clear.
        defaultReceivableAccountId: form.defaultReceivableAccountId || null,
        defaultPayableAccountId: form.defaultPayableAccountId || null,
        defaultCashAccountId: form.defaultCashAccountId || null,
        defaultBankAccountId: form.defaultBankAccountId || null,
        defaultIncomeAccountId: form.defaultIncomeAccountId || null,
        defaultExpenseAccountId: form.defaultExpenseAccountId || null,
        defaultRoundOffAccountId: form.defaultRoundOffAccountId || null,
        defaultFxGainLossAccountId: form.defaultFxGainLossAccountId || null,
      };
      if (editingId) {
        await api.put(`/companies/${editingId}`, payload);
      } else {
        await api.post("/companies", payload);
      }
      setShowForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove(c: Company, e: React.MouseEvent) {
    e.stopPropagation();
    if (c.isDefault) {
      setError("Cannot delete the default Company. Mark another company default first.");
      return;
    }
    if (!confirm(`Delete ${c.name}? This is a hard delete — refused if any GL/SI/PI/PE/JE/IC records reference the company, or if any Account is scoped to it. UserCompanyAccess rows will be removed.`)) return;
    setError(null);
    try {
      const r = await api.del<{ userAccessRowsRemoved: number }>(`/companies/${c.id}`);
      setInfo(`Deleted ${c.name}. ${r.userAccessRowsRemoved} user-access row(s) removed.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  async function cloneCoa(c: Company, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`Clone shared Chart of Accounts into ${c.name}? Non-destructive; existing accounts under this company are skipped.`)) return;
    setError(null);
    try {
      const r = await api.post<{ created: number; skipped: number }>(
        `/companies/${c.id}/clone-coa`,
        {},
      );
      setInfo(`Cloned CoA into ${c.name}: ${r.created} account(s) created, ${r.skipped} skipped`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  async function backfillLegacy() {
    if (!confirm("Stamp companyId = tenant default on every SI/PI/PE/JE + GLEntry with null companyId? Idempotent — safe to re-run.")) return;
    setError(null);
    try {
      const r = await api.post<{
        companyId: string | null;
        salesInvoices: number;
        purchaseInvoices: number;
        paymentEntries: number;
        journalEntries: number;
        glEntries: number;
        skipped?: true;
        reason?: string;
      }>("/companies/backfill-legacy", {});
      if (r.skipped) {
        setError(r.reason ?? "Backfill skipped");
      } else {
        setInfo(
          `Backfill complete → SI ${r.salesInvoices}, PI ${r.purchaseInvoices}, PE ${r.paymentEntries}, JE ${r.journalEntries}, GL ${r.glEntries}`,
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Backfill failed");
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q));
  }, [rows, search]);

  const leafAccounts = useMemo(
    () => accounts.filter((a) => !a.isGroup).sort((a, b) => a.accountName.localeCompare(b.accountName)),
    [accounts],
  );

  const columns: Column<Company>[] = [
    {
      header: "Company",
      cell: (c) => (
        <button onClick={() => openEdit(c)} className="text-start">
          <div className="font-medium text-ink">{c.name}</div>
          <div className="text-xs text-ink-muted font-mono">{c.code}</div>
        </button>
      ),
    },
    {
      header: "GSTIN / Currency",
      cell: (c) => (
        <div className="text-sm text-ink-soft">
          <div className="font-mono text-xs">{c.gstin ?? "—"}</div>
          <div className="text-xs text-ink-muted">{c.baseCurrency}</div>
        </div>
      ),
    },
    {
      header: "Status",
      cell: (c) => (
        <div className="flex items-center gap-2">
          {c.isDefault && <span className="badge-blue">Default</span>}
          {c.disabled && <span className="badge">Disabled</span>}
        </div>
      ),
    },
    {
      header: "",
      align: "right",
      cell: (c) => (
        <div className="flex items-center justify-end gap-2">
          <button onClick={(e) => cloneCoa(c, e)} className="btn-ghost btn-sm">
            Clone CoA…
          </button>
          {!c.isDefault && (
            <button
              onClick={(e) => remove(c, e)}
              className="btn-ghost btn-sm text-red-600"
              title="Hard delete — refused if the company has any transactional refs"
            >
              Delete
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Companies"
        subtitle={`${rows.length} compan${rows.length === 1 ? "y" : "ies"} · one flagged as default receives fallback GL posts`}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={backfillLegacy} title="One-shot: stamp companyId on pre-Phase-2 rows">
              Backfill legacy
            </Button>
            <Button variant="brand" onClick={openCreate}>+ New company</Button>
          </div>
        }
      />

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}
      {info && <div className="mb-4"><Toast kind="success" message={info} onDismiss={() => setInfo(null)} /></div>}

      <div className="space-y-4">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search companies…" }}
          actions={<SavedViewsControls listKey="accounting-web:companies" current={{ search }} onApply={(fv) => setSearch(fv.search)} />}
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(c) => c.id}
          loading={loading}
          empty={{
            icon: Icon.layers,
            title: search ? "No matching companies" : "No companies yet",
            description: search
              ? "Try a different search."
              : "Every tenant gets a default Company auto-seeded. Add more when you need per-branch/per-entity scoping.",
            action: !search && <Button variant="brand" onClick={openCreate}>+ Add company</Button>,
          }}
        />
      </div>

      <Drawer
        open={showForm}
        onClose={() => setShowForm(false)}
        title={editingId ? "Edit company" : "New company"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button variant="brand" disabled={busy} onClick={(e) => submit(e as unknown as React.FormEvent)}>
              {editingId ? "Save changes" : "Create company"}
            </Button>
          </>
        }
      >
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Name" required>
              <input
                className="input"
                placeholder="Acme Corp"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
                autoFocus
              />
            </FormField>
            <FormField label="Code" required hint="Used in numbering (e.g. SINV-AC-0001)">
              <input
                className="input font-mono"
                placeholder="AC"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                required
                maxLength={24}
              />
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="GSTIN">
              <input
                className="input font-mono"
                value={form.gstin}
                onChange={(e) => setForm({ ...form, gstin: e.target.value })}
                maxLength={15}
              />
            </FormField>
            <FormField label="Base currency">
              <input
                className="input"
                value={form.baseCurrency}
                onChange={(e) => setForm({ ...form, baseCurrency: e.target.value.toUpperCase() })}
                maxLength={3}
              />
            </FormField>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isDefault}
              onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
            />
            Default company (fallback when a voucher omits companyId)
          </label>

          <div className="border-t border-line pt-4">
            <div className="text-sm font-medium text-ink mb-1">Default account overrides</div>
            <div className="text-xs text-ink-muted mb-3">Leave blank to inherit the tenant-level default.</div>
            <div className="grid grid-cols-2 gap-3">
              <AccountPicker label="Receivable" value={form.defaultReceivableAccountId}
                onChange={(v) => setForm({ ...form, defaultReceivableAccountId: v })} accounts={leafAccounts} />
              <AccountPicker label="Payable" value={form.defaultPayableAccountId}
                onChange={(v) => setForm({ ...form, defaultPayableAccountId: v })} accounts={leafAccounts} />
              <AccountPicker label="Cash" value={form.defaultCashAccountId}
                onChange={(v) => setForm({ ...form, defaultCashAccountId: v })} accounts={leafAccounts} />
              <AccountPicker label="Bank" value={form.defaultBankAccountId}
                onChange={(v) => setForm({ ...form, defaultBankAccountId: v })} accounts={leafAccounts} />
              <AccountPicker label="Income (Sales)" value={form.defaultIncomeAccountId}
                onChange={(v) => setForm({ ...form, defaultIncomeAccountId: v })} accounts={leafAccounts} />
              <AccountPicker label="Expense (Purchases)" value={form.defaultExpenseAccountId}
                onChange={(v) => setForm({ ...form, defaultExpenseAccountId: v })} accounts={leafAccounts} />
              <AccountPicker label="Round Off" value={form.defaultRoundOffAccountId}
                onChange={(v) => setForm({ ...form, defaultRoundOffAccountId: v })} accounts={leafAccounts} />
              <AccountPicker label="FX Gain/Loss" value={form.defaultFxGainLossAccountId}
                onChange={(v) => setForm({ ...form, defaultFxGainLossAccountId: v })} accounts={leafAccounts} />
            </div>
          </div>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </>
  );
}

function AccountPicker({
  label,
  value,
  onChange,
  accounts,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  accounts: Account[];
}) {
  return (
    <FormField label={label}>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">— inherit tenant default —</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.accountName} · {a.rootType}
          </option>
        ))}
      </select>
    </FormField>
  );
}
