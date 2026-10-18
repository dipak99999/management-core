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

interface Company {
  id: string;
  name: string;
  code: string;
  baseCurrency: string;
  disabled: boolean;
}

interface Account {
  id: string;
  accountName: string;
  rootType: string;
  companyId: string | null;
  isGroup: boolean;
}

interface ICJE {
  id: string;
  amount: string;
  narrative: string | null;
  postingDate: string;
  fromCurrency: string;
  fromConversionRate: string;
  fromNativeAmount: string;
  fromFxGainLoss: string;
  toCurrency: string;
  toConversionRate: string;
  toNativeAmount: string;
  toFxGainLoss: string;
  status: string;
  reversedById: string | null;
  reversesId: string | null;
  cancelledAt: string | null;
  fromCompany?: { name: string; code: string };
  toCompany?: { name: string; code: string };
  fromJournal?: { name: string; status: string };
  toJournal?: { name: string; status: string };
}

const emptyForm = {
  fromCompanyId: "",
  toCompanyId: "",
  amount: "",
  narrative: "",
  postingDate: new Date().toISOString().slice(0, 10),
  from: {
    debitAccountId: "",
    creditAccountId: "",
    currency: "INR",
    conversionRate: 1,
    nativeAmount: "",
  },
  to: {
    debitAccountId: "",
    creditAccountId: "",
    currency: "INR",
    conversionRate: 1,
    nativeAmount: "",
  },
};

// Multi-company Phase 5 admin surface: intercompany JE creation form.
// Handles the multi-currency case natively — each side has its own
// currency + rate; the form computes cashBase and shows the expected
// FX gain/loss in real time so operators see what will post before
// clicking Create.
export default function IntercompanyJournalsPage() {
  const [rows, setRows] = useState<ICJE[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");

  async function load() {
    setLoading(true);
    try {
      const [icje, co, acc] = await Promise.all([
        api.get<ICJE[]>("/intercompany-journals"),
        api.get<Company[]>("/companies"),
        api.get<Account[]>("/accounts"),
      ]);
      setRows(icje);
      setCompanies(co);
      setAccounts(acc);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  useListPageCommands({
    singular: "Intercompany Journal",
    plural: "Intercompany Journals",
    refresh: load,
  });
  function openCreate() {
    setForm(emptyForm);
    setShowForm(true);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const payload = {
        fromCompanyId: form.fromCompanyId,
        toCompanyId: form.toCompanyId,
        amount: Number(form.amount),
        narrative: form.narrative || null,
        postingDate: new Date(form.postingDate).toISOString(),
        from: {
          debitAccountId: form.from.debitAccountId,
          creditAccountId: form.from.creditAccountId,
          currency: form.from.currency,
          conversionRate: Number(form.from.conversionRate),
          nativeAmount: form.from.nativeAmount ? Number(form.from.nativeAmount) : undefined,
        },
        to: {
          debitAccountId: form.to.debitAccountId,
          creditAccountId: form.to.creditAccountId,
          currency: form.to.currency,
          conversionRate: Number(form.to.conversionRate),
          nativeAmount: form.to.nativeAmount ? Number(form.to.nativeAmount) : undefined,
        },
      };
      await api.post("/intercompany-journals", payload);
      setShowForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function reverse(r: ICJE, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`Post a reversal for the ${r.fromCompany?.code}→${r.toCompany?.code} entry (${Number(r.amount).toFixed(2)})? Creates a new IC pair with debit/credit swapped. Original stays intact.`)) return;
    setError(null);
    try {
      await api.post(`/intercompany-journals/${r.id}/reverse`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reverse failed");
    }
  }

  async function cancel(r: ICJE, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`Cancel this IC entry? Voids both mirror JEs and removes their GL impact from reports. Use only for entries posted by mistake.`)) return;
    setError(null);
    try {
      await api.post(`/intercompany-journals/${r.id}/cancel`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cancel failed");
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const hay = `${r.fromCompany?.code ?? ""} ${r.toCompany?.code ?? ""} ${r.narrative ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [rows, search]);

  // Accounts filtered by company scope (or shared) for each picker.
  function accountsFor(companyId: string): Account[] {
    return accounts
      .filter((a) => !a.isGroup)
      .filter((a) => a.companyId === null || a.companyId === companyId)
      .sort((a, b) => a.accountName.localeCompare(b.accountName));
  }

  // Real-time FX preview — mirrors the server-side computeICSide math.
  const preview = useMemo(() => {
    const amount = Number(form.amount) || 0;
    const fromRate = Number(form.from.conversionRate) || 1;
    const toRate = Number(form.to.conversionRate) || 1;
    const fromNative = form.from.nativeAmount ? Number(form.from.nativeAmount) : amount / fromRate;
    const toNative = form.to.nativeAmount ? Number(form.to.nativeAmount) : amount / toRate;
    const fromCashBase = fromNative * fromRate;
    const toCashBase = toNative * toRate;
    return {
      fromNative,
      fromCashBase,
      fromFxDelta: fromCashBase - amount,
      toNative,
      toCashBase,
      toFxDelta: toCashBase - amount,
    };
  }, [form.amount, form.from.conversionRate, form.from.nativeAmount, form.to.conversionRate, form.to.nativeAmount]);

  const columns: Column<ICJE>[] = [
    {
      header: "Date",
      cell: (r) => <span className="text-sm text-ink-soft">{dateShort(r.postingDate)}</span>,
    },
    {
      header: "From → To",
      cell: (r) => (
        <div>
          <div className="font-medium text-ink">
            {r.fromCompany?.code ?? "?"} → {r.toCompany?.code ?? "?"}
          </div>
          <div className="text-xs text-ink-muted">{r.narrative ?? "—"}</div>
        </div>
      ),
    },
    {
      header: "Amount",
      align: "right",
      cell: (r) => (
        <div className="text-end">
          <div className="font-mono text-sm">{Number(r.amount).toFixed(2)}</div>
          {(Number(r.fromFxGainLoss) !== 0 || Number(r.toFxGainLoss) !== 0) && (
            <div className="text-xs text-ink-muted">
              FX: {Number(r.fromFxGainLoss).toFixed(2)} / {Number(r.toFxGainLoss).toFixed(2)}
            </div>
          )}
        </div>
      ),
    },
    {
      header: "JE pair",
      cell: (r) => (
        <div className="text-xs font-mono text-ink-soft">
          <div>{r.fromJournal?.name ?? "—"}</div>
          <div>{r.toJournal?.name ?? "—"}</div>
        </div>
      ),
    },
    {
      header: "Status",
      cell: (r) => {
        if (r.status === "Cancelled")
          return <span className="badge bg-red-100 text-red-700">Cancelled</span>;
        if (r.status === "Reversed")
          return <span className="badge bg-amber-100 text-amber-700">Reversed</span>;
        if (r.reversesId)
          return <span className="badge bg-slate-100 text-slate-700">Reversal</span>;
        return <span className="badge-blue">Active</span>;
      },
    },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <div className="flex items-center justify-end gap-1">
          {r.status === "Active" && (
            <>
              <button onClick={(e) => reverse(r, e)} className="btn-ghost btn-sm">
                Reverse
              </button>
              <button onClick={(e) => cancel(r, e)} className="btn-ghost btn-sm text-red-600">
                Cancel
              </button>
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Intercompany Journal Entries"
        subtitle={`${rows.length} pair${rows.length === 1 ? "" : "s"} · each posts two mirror JEs auto-eliminated at consolidation`}
        actions={<Button variant="brand" onClick={openCreate}>+ New IC entry</Button>}
      />

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}

      <div className="space-y-4">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search by company code or narrative…" }}
          actions={<SavedViewsControls listKey="accounting-web:intercompany-journals" current={{ search }} onApply={(fv) => setSearch(fv.search)} />}
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.id}
          loading={loading}
          empty={{
            icon: Icon.book,
            title: "No intercompany journals yet",
            description: "Post an intercompany transfer to move value between two companies with a linked, auto-eliminating JE pair.",
            action: <Button variant="brand" onClick={openCreate}>+ Create one</Button>,
          }}
        />
      </div>

      <Drawer
        open={showForm}
        onClose={() => setShowForm(false)}
        title="New intercompany journal"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button variant="brand" disabled={busy} onClick={(e) => submit(e as unknown as React.FormEvent)}>
              Post entry
            </Button>
          </>
        }
      >
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="From company" required>
              <select
                className="input"
                value={form.fromCompanyId}
                onChange={(e) => setForm({ ...form, fromCompanyId: e.target.value })}
                required
              >
                <option value="">— pick —</option>
                {companies.filter((c) => !c.disabled).map((c) => (
                  <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
                ))}
              </select>
            </FormField>
            <FormField label="To company" required>
              <select
                className="input"
                value={form.toCompanyId}
                onChange={(e) => setForm({ ...form, toCompanyId: e.target.value })}
                required
              >
                <option value="">— pick —</option>
                {companies.filter((c) => !c.disabled && c.id !== form.fromCompanyId).map((c) => (
                  <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
                ))}
              </select>
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Base amount" required hint="Canonical amount in tenant baseCurrency">
              <input
                type="number"
                step="0.01"
                className="input font-mono"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                required
              />
            </FormField>
            <FormField label="Posting date" required>
              <input
                type="date"
                className="input"
                value={form.postingDate}
                onChange={(e) => setForm({ ...form, postingDate: e.target.value })}
                required
              />
            </FormField>
          </div>

          <FormField label="Narrative">
            <input
              className="input"
              value={form.narrative}
              onChange={(e) => setForm({ ...form, narrative: e.target.value })}
              placeholder="e.g. Cash transfer for shared vendor payment"
            />
          </FormField>

          <SideSection
            label="FROM side"
            side={form.from}
            onChange={(next) => setForm({ ...form, from: next })}
            accounts={form.fromCompanyId ? accountsFor(form.fromCompanyId) : []}
            preview={{
              native: preview.fromNative,
              cashBase: preview.fromCashBase,
              fxDelta: preview.fromFxDelta,
            }}
          />
          <SideSection
            label="TO side"
            side={form.to}
            onChange={(next) => setForm({ ...form, to: next })}
            accounts={form.toCompanyId ? accountsFor(form.toCompanyId) : []}
            preview={{
              native: preview.toNative,
              cashBase: preview.toCashBase,
              fxDelta: preview.toFxDelta,
            }}
          />

          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </>
  );
}

function SideSection({
  label,
  side,
  onChange,
  accounts,
  preview,
}: {
  label: string;
  side: {
    debitAccountId: string;
    creditAccountId: string;
    currency: string;
    conversionRate: number;
    nativeAmount: string;
  };
  onChange: (next: typeof side) => void;
  accounts: Account[];
  preview: { native: number; cashBase: number; fxDelta: number };
}) {
  return (
    <div className="border border-line rounded p-3 space-y-3">
      <div className="text-sm font-medium text-ink">{label}</div>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Debit account" required>
          <select
            className="input"
            value={side.debitAccountId}
            onChange={(e) => onChange({ ...side, debitAccountId: e.target.value })}
            required
          >
            <option value="">— pick —</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.accountName} · {a.rootType}</option>
            ))}
          </select>
        </FormField>
        <FormField label="Credit account" required>
          <select
            className="input"
            value={side.creditAccountId}
            onChange={(e) => onChange({ ...side, creditAccountId: e.target.value })}
            required
          >
            <option value="">— pick —</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.accountName} · {a.rootType}</option>
            ))}
          </select>
        </FormField>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <FormField label="Currency">
          <input
            className="input"
            value={side.currency}
            onChange={(e) => onChange({ ...side, currency: e.target.value.toUpperCase() })}
            maxLength={3}
          />
        </FormField>
        <FormField label="FX rate" hint="→ base">
          <input
            type="number"
            step="0.000001"
            className="input font-mono"
            value={side.conversionRate}
            onChange={(e) => onChange({ ...side, conversionRate: Number(e.target.value) })}
          />
        </FormField>
        <FormField label="Native amount" hint="Leave blank to auto-derive">
          <input
            type="number"
            step="0.01"
            className="input font-mono"
            value={side.nativeAmount}
            onChange={(e) => onChange({ ...side, nativeAmount: e.target.value })}
          />
        </FormField>
      </div>
      <div className="text-xs text-ink-muted font-mono bg-panel rounded p-2">
        native {preview.native.toFixed(2)} × {side.conversionRate} → cash base {preview.cashBase.toFixed(2)}
        {Math.abs(preview.fxDelta) > 0.0001 && (
          <span className="text-orange-600 ms-2">
            · FX {preview.fxDelta > 0 ? "gain/loss" : "gain/loss"} {preview.fxDelta.toFixed(2)}
          </span>
        )}
      </div>
    </div>
  );
}
