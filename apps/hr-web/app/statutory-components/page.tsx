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
  dateShort,
  money,
  type Column,
} from "../../components/ui";

interface StatComp {
  id: string;
  name: string;
  slipComponentName: string;
  employeeSharePercent: string;
  employerSharePercent: string;
  monthlyGrossCeiling: string | null;
  flatAmount: string | null;
  applicableFrom: string;
  applicableTo: string | null;
  enabled: boolean;
}

const PRESETS = [
  {
    name: "PF",
    slipComponentName: "Provident Fund",
    employeeSharePercent: 12,
    employerSharePercent: 12,
    monthlyGrossCeiling: 15000,
  },
  {
    name: "ESI",
    slipComponentName: "ESI",
    employeeSharePercent: 0.75,
    employerSharePercent: 3.25,
    monthlyGrossCeiling: 21000,
  },
  {
    name: "PT",
    slipComponentName: "Professional Tax",
    flatAmount: 200,
  },
  {
    name: "TDS",
    slipComponentName: "TDS",
    employeeSharePercent: 10,
  },
];

const emptyForm = {
  name: "",
  slipComponentName: "",
  employeeSharePercent: "",
  employerSharePercent: "",
  monthlyGrossCeiling: "",
  flatAmount: "",
  applicableFrom: new Date().toISOString().slice(0, 10),
  enabled: true,
};

export default function StatutoryComponentsPage() {
  const [rows, setRows] = useState<StatComp[]>([]);
  const [form, setForm] = useState({ ...emptyForm });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setRows(await api.get<StatComp[]>("/statutory-components"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => {
    load();
  }, []);

  useListPageCommands({
    singular: "Statutory Component",
    plural: "Statutory Components",
    refresh: load,
  });

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/statutory-components", {
        name: form.name,
        slipComponentName: form.slipComponentName || form.name,
        employeeSharePercent: Number(form.employeeSharePercent || 0),
        employerSharePercent: Number(form.employerSharePercent || 0),
        monthlyGrossCeiling: form.monthlyGrossCeiling
          ? Number(form.monthlyGrossCeiling)
          : null,
        flatAmount: form.flatAmount ? Number(form.flatAmount) : null,
        applicableFrom: new Date(form.applicableFrom).toISOString(),
        enabled: form.enabled,
      });
      setForm({ ...emptyForm });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(row: StatComp) {
    try {
      await api.put(`/statutory-components/${row.id}`, { enabled: !row.enabled });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  function loadPreset(name: string) {
    const p = PRESETS.find((x) => x.name === name);
    if (!p) return;
    setForm({
      ...emptyForm,
      name: p.name,
      slipComponentName: p.slipComponentName,
      employeeSharePercent: p.employeeSharePercent?.toString() ?? "",
      employerSharePercent: p.employerSharePercent?.toString() ?? "",
      monthlyGrossCeiling: p.monthlyGrossCeiling?.toString() ?? "",
      flatAmount: p.flatAmount?.toString() ?? "",
    });
  }

  const cols: Column<StatComp>[] = [
    { header: "Name", cell: (r) => <span className="font-medium">{r.name}</span> },
    { header: "Slip label", cell: (r) => r.slipComponentName },
    {
      header: "Emp %",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums">
          {Number(r.employeeSharePercent).toFixed(3)}
        </span>
      ),
    },
    {
      header: "Empr %",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums">
          {Number(r.employerSharePercent).toFixed(3)}
        </span>
      ),
    },
    {
      header: "Ceiling",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums">
          {r.monthlyGrossCeiling ? money(Number(r.monthlyGrossCeiling)) : "—"}
        </span>
      ),
    },
    {
      header: "Flat",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums">
          {r.flatAmount ? money(Number(r.flatAmount)) : "—"}
        </span>
      ),
    },
    {
      header: "From",
      cell: (r) => <span className="text-xs">{dateShort(r.applicableFrom)}</span>,
    },
    {
      header: "Enabled",
      cell: (r) => (
        <button
          onClick={() => toggle(r)}
          className={r.enabled ? "badge-green" : "badge-gray"}
        >
          {r.enabled ? "On" : "Off"}
        </button>
      ),
    },
  ];

  return (
    <main className="p-8 space-y-6 max-w-6xl">
      <PageHeader
        breadcrumb={[
          { label: "HR & Payroll", href: "/hr" },
          { label: "Statutory components" },
        ]}
        title="Statutory components"
        subtitle="PF, ESI, PT, TDS — auto-added as deductions on Salary Slips."
      />

      {error && (
        <Card className="p-4 text-red-700 border-red-200 bg-red-50 text-sm">
          {error}
        </Card>
      )}

      <Card className="p-4 space-y-3">
        <SectionHeader
          title="Add component"
          actions={
            <div className="flex gap-2 text-xs items-center">
              <span className="text-ink-muted">Load preset:</span>
              {PRESETS.map((p) => (
                <button
                  key={p.name}
                  onClick={() => loadPreset(p.name)}
                  className="text-brand-600 hover:underline"
                >
                  {p.name}
                </button>
              ))}
            </div>
          }
        />
        <form onSubmit={create} className="grid grid-cols-4 gap-3 items-end">
          <FormField label="Name" required>
            <input
              className="input"
              placeholder="PF/ESI/PT/TDS"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </FormField>
          <FormField label="Slip label">
            <input
              className="input"
              value={form.slipComponentName}
              onChange={(e) =>
                setForm({ ...form, slipComponentName: e.target.value })
              }
            />
          </FormField>
          <FormField label="Employee %">
            <input
              type="number"
              step="0.001"
              className="input"
              value={form.employeeSharePercent}
              onChange={(e) =>
                setForm({ ...form, employeeSharePercent: e.target.value })
              }
            />
          </FormField>
          <FormField label="Employer %">
            <input
              type="number"
              step="0.001"
              className="input"
              value={form.employerSharePercent}
              onChange={(e) =>
                setForm({ ...form, employerSharePercent: e.target.value })
              }
            />
          </FormField>
          <FormField label="Gross ceiling (opt)">
            <input
              type="number"
              step="0.01"
              className="input"
              value={form.monthlyGrossCeiling}
              onChange={(e) =>
                setForm({ ...form, monthlyGrossCeiling: e.target.value })
              }
            />
          </FormField>
          <FormField label="Flat amount (opt)">
            <input
              type="number"
              step="0.01"
              className="input"
              value={form.flatAmount}
              onChange={(e) => setForm({ ...form, flatAmount: e.target.value })}
            />
          </FormField>
          <FormField label="Applicable from">
            <input
              type="date"
              className="input"
              value={form.applicableFrom}
              onChange={(e) =>
                setForm({ ...form, applicableFrom: e.target.value })
              }
            />
          </FormField>
          <Button variant="primary" type="submit" disabled={busy}>
            + Add
          </Button>
        </form>
      </Card>

      <DataTable<StatComp>
        columns={cols}
        rows={rows}
        rowKey={(r) => r.id}
        empty={{ title: "No statutory components configured" }}
      />
    </main>
  );
}
