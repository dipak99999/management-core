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
  Toast,
  dateShort,
  type Column,
} from "../../components/ui";
import { Icon } from "../../components/app-shell";

interface Rate {
  id: string;
  fromCurrency: string;
  toCurrency: string;
  effectiveDate: string;
  rate: string;
  source: string | null;
  createdAt: string;
}
interface Currency {
  id: string;
  code: string;
  name: string;
}
interface CurrenciesEnvelope {
  baseCurrency: string;
  rows: Currency[];
}

const emptyForm = () => ({
  fromCurrency: "USD",
  toCurrency: "INR",
  effectiveDate: new Date().toISOString().slice(0, 10),
  rate: 0,
  source: "Manual",
});

export default function ExchangeRatesPage() {
  const [rows, setRows] = useState<Rate[]>([]);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm());
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState("");

  async function load() {
    setLoading(true);
    try {
      setRows(await api.get<Rate[]>("/exchange-rates"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    api
      .get<CurrenciesEnvelope>("/currencies")
      .then((d) => {
        setCurrencies(d.rows);
        setForm((f) => ({ ...f, toCurrency: d.baseCurrency }));
      })
      .catch(() => {});
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (form.fromCurrency === form.toCurrency) {
      setError("from and to must differ");
      return;
    }
    try {
      await api.post("/exchange-rates", form);
      setForm(emptyForm());
      setShowForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  async function del(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm("Delete this rate?")) return;
    try {
      await api.del(`/exchange-rates/${id}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      `${r.fromCurrency} ${r.toCurrency} ${r.source ?? ""}`.toLowerCase().includes(q),
    );
  }, [rows, search]);

  const columns: Column<Rate>[] = [
    {
      header: "Pair",
      cell: (r) => (
        <span className="font-mono text-sm text-ink">
          {r.fromCurrency} → {r.toCurrency}
        </span>
      ),
    },
    { header: "Effective", cell: (r) => <span className="text-ink-soft">{dateShort(r.effectiveDate)}</span> },
    {
      header: "Rate",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums font-medium text-ink">{Number(r.rate).toFixed(6)}</span>
      ),
    },
    { header: "Source", cell: (r) => <span className="text-xs text-ink-muted">{r.source ?? "—"}</span> },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <button onClick={(e) => del(r.id, e)} className="btn-ghost btn-sm text-red-600">Delete</button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Exchange Rates"
        subtitle={`${rows.length} rate${rows.length === 1 ? "" : "s"} configured`}
        actions={
          <Button variant="brand" onClick={() => setShowForm(true)}>+ Add rate</Button>
        }
      />

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}

      <div className="space-y-4">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search currency pair or source…" }}
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.id}
          loading={loading}
          empty={{
            icon: Icon.bar,
            title: search ? "No matching rates" : "No rates configured",
            description: search
              ? "Try a different search term."
              : "Add exchange rates so foreign-currency invoices can post to base GL.",
            action: !search && (
              <Button variant="brand" onClick={() => setShowForm(true)}>+ Add rate</Button>
            ),
          }}
        />
      </div>

      <Drawer
        open={showForm}
        onClose={() => setShowForm(false)}
        title="Add exchange rate"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button variant="brand" onClick={(e) => save(e as unknown as React.FormEvent)}>
              Save rate
            </Button>
          </>
        }
      >
        <form onSubmit={save} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="From" required>
              <select
                required
                className="input"
                value={form.fromCurrency}
                onChange={(e) => setForm({ ...form, fromCurrency: e.target.value })}
              >
                {currencies.map((c) => (
                  <option key={c.id} value={c.code}>{c.code}</option>
                ))}
              </select>
            </FormField>
            <FormField label="To" required>
              <select
                required
                className="input"
                value={form.toCurrency}
                onChange={(e) => setForm({ ...form, toCurrency: e.target.value })}
              >
                {currencies.map((c) => (
                  <option key={c.id} value={c.code}>{c.code}</option>
                ))}
              </select>
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Effective date" required>
              <input
                type="date"
                required
                className="input"
                value={form.effectiveDate}
                onChange={(e) => setForm({ ...form, effectiveDate: e.target.value })}
              />
            </FormField>
            <FormField label="Rate" required>
              <input
                type="number"
                step="any"
                min={0.000001}
                required
                className="input"
                value={form.rate}
                onChange={(e) => setForm({ ...form, rate: Number(e.target.value) })}
              />
            </FormField>
          </div>
          <FormField label="Source">
            <input
              className="input"
              value={form.source}
              onChange={(e) => setForm({ ...form, source: e.target.value })}
            />
          </FormField>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </>
  );
}
