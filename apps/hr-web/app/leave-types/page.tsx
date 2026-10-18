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

interface LeaveType {
  id: string;
  leaveTypeName: string;
  isEncashable: boolean;
  maxDaysPerYear: number;
  color: string | null;
}

const STYLE_PRESETS = [
  { label: "Blue", value: "bg-blue-100 text-blue-800" },
  { label: "Green", value: "bg-green-100 text-green-800" },
  { label: "Yellow", value: "bg-yellow-100 text-yellow-800" },
  { label: "Red", value: "bg-red-100 text-red-800" },
  { label: "Purple", value: "bg-purple-100 text-purple-800" },
];

const emptyForm = { leaveTypeName: "", isEncashable: false, maxDaysPerYear: 0, color: "" };

export default function LeaveTypesPage() {
  const [rows, setRows] = useState<LeaveType[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setRows(await api.get<LeaveType[]>("/leave-types"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => {
    load();
  }, []);

  useListPageCommands({
    singular: "Leave Type",
    plural: "Leave Types",
    refresh: load,
  });

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await api.post("/leave-types", {
        ...form,
        color: form.color || null,
      });
      setForm(emptyForm);
      setShowForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const cols: Column<LeaveType>[] = [
    {
      header: "Name",
      cell: (r) => <span className="font-medium">{r.leaveTypeName}</span>,
    },
    {
      header: "Max days/year",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums">
          {r.maxDaysPerYear > 0 ? r.maxDaysPerYear : "—"}
        </span>
      ),
    },
    {
      header: "Encashable",
      cell: (r) => (
        <span className="text-xs">{r.isEncashable ? "Yes" : "No"}</span>
      ),
    },
    {
      header: "Badge",
      cell: (r) =>
        r.color ? (
          <span className={`px-2 py-0.5 rounded text-xs ${r.color}`}>
            {r.leaveTypeName}
          </span>
        ) : null,
    },
  ];

  return (
    <main className="p-8 space-y-6 max-w-4xl">
      <PageHeader
        breadcrumb={[
          { label: "HR & Payroll", href: "/hr" },
          { label: "Leave types" },
        ]}
        title="Leave types"
        subtitle={`${rows.length} type${rows.length === 1 ? "" : "s"}`}
        actions={
          <Button
            variant="primary"
            onClick={() => setShowForm((s) => !s)}
            type="button"
          >
            {showForm ? "Cancel" : "+ New leave type"}
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
          <SectionHeader title="New leave type" />
          <form onSubmit={create} className="space-y-3">
            <FormField label="Name" required>
              <input
                className="input"
                placeholder="Casual, Sick, Earned…"
                value={form.leaveTypeName}
                onChange={(e) =>
                  setForm({ ...form, leaveTypeName: e.target.value })
                }
                required
              />
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Max days/year">
                <input
                  type="number"
                  min={0}
                  className="input"
                  value={form.maxDaysPerYear}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      maxDaysPerYear: Number(e.target.value),
                    })
                  }
                />
              </FormField>
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
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isEncashable}
                onChange={(e) =>
                  setForm({ ...form, isEncashable: e.target.checked })
                }
              />
              Encashable
            </label>
            <div className="flex justify-end">
              <Button variant="primary" type="submit" disabled={busy}>
                {busy ? "Saving…" : "Save"}
              </Button>
            </div>
          </form>
        </Card>
      )}

      <DataTable<LeaveType>
        columns={cols}
        rows={rows}
        rowKey={(r) => r.id}
        empty={{ title: "No leave types yet" }}
      />
    </main>
  );
}
