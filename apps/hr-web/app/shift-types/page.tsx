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
  SectionHeader,
  type Column,
} from "../../components/ui";

interface ShiftType {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  workingHours: string;
  color: string | null;
}

const STYLE_PRESETS = [
  { label: "Blue", value: "bg-blue-100 text-blue-800" },
  { label: "Green", value: "bg-green-100 text-green-800" },
  { label: "Yellow", value: "bg-yellow-100 text-yellow-800" },
  { label: "Purple", value: "bg-purple-100 text-purple-800" },
];

const emptyForm = {
  name: "",
  startTime: "09:00",
  endTime: "17:00",
  workingHours: 8,
  color: "",
};

export default function ShiftTypesPage() {
  const [rows, setRows] = useState<ShiftType[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setRows(await api.get<ShiftType[]>("/shift-types"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => {
    load();
  }, []);

  useListPageCommands({
    singular: "Shift Type",
    plural: "Shift Types",
    refresh: load,
  });

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await api.post("/shift-types", { ...form, color: form.color || null });
      setForm(emptyForm);
      setShowForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const cols: Column<ShiftType>[] = [
    { header: "Name", cell: (r) => <span className="font-medium">{r.name}</span> },
    {
      header: "Hours",
      cell: (r) => (
        <span className="text-sm text-ink-muted">
          {r.startTime} → {r.endTime}
        </span>
      ),
    },
    {
      header: "Working hrs",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums">{Number(r.workingHours)}</span>
      ),
    },
    {
      header: "Badge",
      cell: (r) =>
        r.color ? (
          <span className={`px-2 py-0.5 rounded text-xs ${r.color}`}>
            {r.name}
          </span>
        ) : null,
    },
  ];

  return (
    <main className="p-8 space-y-6 max-w-4xl">
      <PageHeader
        breadcrumb={[
          { label: "HR & Payroll", href: "/hr" },
          { label: "Shift types" },
        ]}
        title="Shift types"
        subtitle="Named work-day patterns (Morning, Night, etc.)."
        actions={
          <Button
            variant="primary"
            onClick={() => setShowForm((s) => !s)}
            type="button"
          >
            {showForm ? "Cancel" : "+ New shift"}
          </Button>
        }
      />

      {error && (
        <Card className="p-4 text-red-700 border-red-200 bg-red-50 text-sm">
          {error}
        </Card>
      )}

      {showForm && (
        <Card className="p-4 max-w-md">
          <SectionHeader title="New shift type" />
          <form onSubmit={create} className="space-y-3">
            <FormField label="Shift name" required>
              <input
                required
                className="input"
                placeholder="Morning"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </FormField>
            <div className="grid grid-cols-3 gap-3">
              <FormField label="Start (HH:MM)" required>
                <input
                  required
                  type="time"
                  className="input"
                  value={form.startTime}
                  onChange={(e) =>
                    setForm({ ...form, startTime: e.target.value })
                  }
                />
              </FormField>
              <FormField label="End (HH:MM)" required>
                <input
                  required
                  type="time"
                  className="input"
                  value={form.endTime}
                  onChange={(e) =>
                    setForm({ ...form, endTime: e.target.value })
                  }
                />
              </FormField>
              <FormField label="Working hours">
                <input
                  type="number"
                  step="0.5"
                  min={0.5}
                  className="input"
                  value={form.workingHours}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      workingHours: Number(e.target.value),
                    })
                  }
                />
              </FormField>
            </div>
            <FormField label="Badge color">
              <select
                className="input"
                value={form.color}
                onChange={(e) => setForm({ ...form, color: e.target.value })}
              >
                <option value="">(no color)</option>
                {STYLE_PRESETS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </FormField>
            <div className="flex justify-end">
              <Button variant="primary" type="submit" disabled={busy}>
                {busy ? "Saving…" : "Save"}
              </Button>
            </div>
          </form>
        </Card>
      )}

      <DataTable<ShiftType>
        columns={cols}
        rows={rows}
        rowKey={(r) => r.id}
        empty={{ title: "No shifts yet" }}
      />
    </main>
  );
}
