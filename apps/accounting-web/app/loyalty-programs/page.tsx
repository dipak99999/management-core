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

// D5: Loyalty Programs admin. On SI submit, if the customer's
// loyaltyProgramId matches an enabled program, the customer earns
// floor(grandTotal × pointsPerCurrency) points; points expire after
// `expiryMonths`.

interface Program {
  id: string;
  name: string;
  pointsPerCurrency: string;
  minRedemptionPoints: number;
  maxRedemptionPercent: string;
  expiryMonths: number;
  enabled: boolean;
}

const empty = {
  name: "",
  pointsPerCurrency: 0.01,
  minRedemptionPoints: 0,
  maxRedemptionPercent: 100,
  expiryMonths: 24,
  enabled: true,
};

export default function LoyaltyProgramsPage() {
  const [rows, setRows] = useState<Program[]>([]);
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setRows(await api.get<Program[]>("/loyalty-programs"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }
  useEffect(() => {
    load();
  }, []);

  useListPageCommands({
    singular: "Loyalty Program",
    plural: "Loyalty Programs",
    refresh: load,
  });

  function edit(p: Program) {
    setForm({
      name: p.name,
      pointsPerCurrency: Number(p.pointsPerCurrency),
      minRedemptionPoints: p.minRedemptionPoints,
      maxRedemptionPercent: Number(p.maxRedemptionPercent),
      expiryMonths: p.expiryMonths,
      enabled: p.enabled,
    });
    setEditingId(p.id);
    setShowForm(true);
  }
  function cancel() {
    setForm(empty);
    setEditingId(null);
    setShowForm(false);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      if (editingId) await api.put(`/loyalty-programs/${editingId}`, form);
      else await api.post("/loyalty-programs", form);
      cancel();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this program?")) return;
    try {
      await api.del(`/loyalty-programs/${id}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  const cols: Column<Program>[] = [
    { header: "Name", cell: (p) => <span className="font-medium">{p.name}</span> },
    {
      header: "Points / unit",
      align: "right",
      cell: (p) => <span className="tabular-nums">{Number(p.pointsPerCurrency).toFixed(4)}</span>,
    },
    { header: "Expiry (mo)", align: "right", cell: (p) => <span className="tabular-nums">{p.expiryMonths}</span> },
    {
      header: "Max redeem %",
      align: "right",
      cell: (p) => <span className="tabular-nums">{Number(p.maxRedemptionPercent).toFixed(2)}</span>,
    },
    {
      header: "Status",
      cell: (p) =>
        p.enabled ? (
          <span className="badge-green">Active</span>
        ) : (
          <span className="badge-gray">Disabled</span>
        ),
    },
    {
      header: "",
      align: "right",
      cell: (p) => (
        <span className="space-x-2 text-xs">
          <button onClick={() => edit(p)} className="text-brand-600">Edit</button>
          <button onClick={() => remove(p.id)} className="text-red-600">Delete</button>
        </span>
      ),
    },
  ];

  return (
    <main className="p-8 space-y-4 max-w-3xl">
      <PageHeader
        breadcrumb={[
          { label: "Home", href: "/" },
          { label: "Loyalty Programs" },
        ]}
        title="Loyalty Programs"
        actions={
          <Button
            variant="primary"
            onClick={() => (showForm ? cancel() : setShowForm(true))}
            type="button"
          >
            {showForm ? "Cancel" : "+ New Program"}
          </Button>
        }
      />
      {error && (
        <Card className="p-3 text-red-700 border-red-200 bg-red-50 text-sm">{error}</Card>
      )}

      {showForm && (
        <Card className="p-4">
          <form onSubmit={save} className="space-y-3">
            <FormField label="Program name" required>
              <input
                required
                className="input"
                placeholder="e.g. Rewards"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Points per 1 unit of grand total" hint="e.g. 0.01 = 1 point per ₹100 spent">
                <input
                  type="number"
                  step="0.0001"
                  min={0}
                  className="input tabular-nums"
                  value={form.pointsPerCurrency}
                  onChange={(e) =>
                    setForm({ ...form, pointsPerCurrency: Number(e.target.value) })
                  }
                />
              </FormField>
              <FormField label="Point expiry (months)">
                <input
                  type="number"
                  min={1}
                  className="input tabular-nums"
                  value={form.expiryMonths}
                  onChange={(e) => setForm({ ...form, expiryMonths: Number(e.target.value) })}
                />
              </FormField>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Min redemption points">
                <input
                  type="number"
                  min={0}
                  className="input tabular-nums"
                  value={form.minRedemptionPoints}
                  onChange={(e) =>
                    setForm({ ...form, minRedemptionPoints: Number(e.target.value) })
                  }
                />
              </FormField>
              <FormField label="Max redemption % of invoice">
                <input
                  type="number"
                  min={0}
                  max={100}
                  step="any"
                  className="input tabular-nums"
                  value={form.maxRedemptionPercent}
                  onChange={(e) =>
                    setForm({ ...form, maxRedemptionPercent: Number(e.target.value) })
                  }
                />
              </FormField>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
              />
              Enabled
            </label>
            <Button variant="primary" type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </form>
        </Card>
      )}

      <DataTable<Program>
        columns={cols}
        rows={rows}
        rowKey={(p) => p.id}
        empty={{ title: "No loyalty programs yet" }}
      />
    </main>
  );
}
