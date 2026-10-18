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

interface Currency {
  id: string;
  code: string;
  name: string;
  symbol: string;
  isEnabled: boolean;
}
interface Envelope {
  baseCurrency: string;
  rows: Currency[];
}

export default function CurrenciesPage() {
  const [data, setData] = useState<Envelope | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ code: "", name: "", symbol: "" });
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  async function load() {
    setLoading(true);
    try {
      setData(await api.get<Envelope>("/currencies"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  useListPageCommands({
    singular: "Currency",
    plural: "Currencies",
    refresh: load,
  });
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/currencies", form);
      setForm({ code: "", name: "", symbol: "" });
      setShowForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  const rows = useMemo(() => data?.rows ?? [], [data?.rows]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((c) =>
      `${c.code} ${c.name}`.toLowerCase().includes(q),
    );
  }, [rows, search]);

  const columns: Column<Currency>[] = [
    {
      header: "Code",
      cell: (c) => <span className="font-mono font-semibold text-ink">{c.code}</span>,
    },
    { header: "Name", cell: (c) => <span className="text-ink">{c.name}</span> },
    { header: "Symbol", cell: (c) => <span className="text-lg text-ink">{c.symbol}</span> },
    {
      header: "",
      align: "right",
      cell: (c) =>
        c.code === data?.baseCurrency ? <span className="badge-brand">Base</span> : null,
    },
  ];

  return (
    <>
      <PageHeader
        title="Currencies"
        subtitle={
          data
            ? `Base currency: ${data.baseCurrency} · ${rows.length} currenc${rows.length === 1 ? "y" : "ies"}`
            : "Loading…"
        }
        actions={
          <Button variant="brand" onClick={() => setShowForm(true)}>+ New currency</Button>
        }
      />

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}

      <div className="space-y-4">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search code or name…" }}
          actions={<SavedViewsControls listKey="accounting-web:currencies" current={{ search }} onApply={(fv) => setSearch(fv.search)} />}
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(c) => c.id}
          loading={loading}
          empty={{
            icon: Icon.cash,
            title: search ? "No matching currencies" : "No currencies yet",
            description: search
              ? "Try a different search term."
              : "Add a currency to invoice in.",
            action: !search && (
              <Button variant="brand" onClick={() => setShowForm(true)}>+ Add currency</Button>
            ),
          }}
        />
      </div>

      <Drawer
        open={showForm}
        onClose={() => setShowForm(false)}
        title="New currency"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button variant="brand" onClick={(e) => create(e as unknown as React.FormEvent)}>
              Create currency
            </Button>
          </>
        }
      >
        <form onSubmit={create} className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <FormField label="Code" required>
              <input
                className="input font-mono uppercase"
                placeholder="INR"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                required
                autoFocus
              />
            </FormField>
            <div className="col-span-2">
              <FormField label="Name" required>
                <input
                  className="input"
                  placeholder="Indian Rupee"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </FormField>
            </div>
          </div>
          <FormField label="Symbol" required>
            <input
              className="input"
              placeholder="₹"
              value={form.symbol}
              onChange={(e) => setForm({ ...form, symbol: e.target.value })}
              required
            />
          </FormField>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </>
  );
}
