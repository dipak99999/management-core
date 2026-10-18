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
  SectionHeader,
  money,
  type Column,
} from "../../components/ui";

interface Component {
  componentName: string;
  type: "Earning" | "Deduction";
  amount: number;
  formula: string;
  sortOrder: number;
}
interface Structure {
  id: string;
  name: string;
  isActive: boolean;
  description: string | null;
  _count: { components: number; employees: number };
}

const emptyComponent: Component = {
  componentName: "",
  type: "Earning",
  amount: 0,
  formula: "",
  sortOrder: 0,
};

export default function SalaryStructuresPage() {
  const [rows, setRows] = useState<Structure[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: "",
    description: "",
    isActive: true,
    components: [{ ...emptyComponent, componentName: "Basic" }],
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setRows(await api.get<Structure[]>("/salary-structures"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => {
    load();
  }, []);

  useListPageCommands({
    singular: "Salary Structure",
    plural: "Salary Structures",
    refresh: load,
  });

  function addComponent(type: "Earning" | "Deduction") {
    setForm((f) => ({
      ...f,
      components: [
        ...f.components,
        { ...emptyComponent, type, sortOrder: f.components.length },
      ],
    }));
  }
  function updateComponent(i: number, patch: Partial<Component>) {
    setForm((f) => ({
      ...f,
      components: f.components.map((c, idx) => (idx === i ? { ...c, ...patch } : c)),
    }));
  }
  function removeComponent(i: number) {
    setForm((f) => ({
      ...f,
      components: f.components.filter((_, idx) => idx !== i),
    }));
  }

  const totals = useMemo(() => {
    const gross = form.components
      .filter((c) => c.type === "Earning")
      .reduce((s, c) => s + Number(c.amount), 0);
    const ded = form.components
      .filter((c) => c.type === "Deduction")
      .reduce((s, c) => s + Number(c.amount), 0);
    return { gross, ded, net: gross - ded };
  }, [form.components]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await api.post("/salary-structures", {
        ...form,
        description: form.description || null,
        components: form.components.map((c) => ({
          ...c,
          formula: c.formula.trim() || null,
        })),
      });
      setForm({
        name: "",
        description: "",
        isActive: true,
        components: [{ ...emptyComponent, componentName: "Basic" }],
      });
      setShowForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const cols: Column<Structure>[] = [
    { header: "Name", cell: (r) => <span className="font-medium">{r.name}</span> },
    {
      header: "Active",
      cell: (r) => (
        <span className={r.isActive ? "badge-green" : "badge-gray"}>
          {r.isActive ? "Active" : "Inactive"}
        </span>
      ),
    },
    {
      header: "Components",
      align: "right",
      cell: (r) => <span className="tabular-nums">{r._count.components}</span>,
    },
    {
      header: "Employees",
      align: "right",
      cell: (r) => <span className="tabular-nums">{r._count.employees}</span>,
    },
  ];

  return (
    <main className="p-8 space-y-6 max-w-6xl">
      <PageHeader
        breadcrumb={[
          { label: "HR & Payroll", href: "/hr" },
          { label: "Salary structures" },
        ]}
        title="Salary structures"
        subtitle="Reusable templates of earnings + deductions per employee."
        actions={
          <Button
            variant="primary"
            onClick={() => setShowForm((s) => !s)}
            type="button"
          >
            {showForm ? "Cancel" : "+ New structure"}
          </Button>
        }
      />

      {error && (
        <Card className="p-4 text-red-700 border-red-200 bg-red-50 text-sm">
          {error}
        </Card>
      )}

      {showForm && (
        <Card className="p-4 max-w-3xl">
          <SectionHeader title="New salary structure" />
          <form onSubmit={create} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Name" required>
                <input
                  required
                  className="input"
                  placeholder="Standard 2025…"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </FormField>
              <label className="flex items-end gap-2 text-sm pb-2">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) =>
                    setForm({ ...form, isActive: e.target.checked })
                  }
                />
                Active
              </label>
            </div>
            <FormField label="Description">
              <input
                className="input"
                placeholder="(optional)"
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
              />
            </FormField>

            <SectionHeader
              title="Components"
              actions={
                <div className="space-x-2 text-xs">
                  <button
                    type="button"
                    onClick={() => addComponent("Earning")}
                    className="text-green-700 hover:underline"
                  >
                    + Earning
                  </button>
                  <button
                    type="button"
                    onClick={() => addComponent("Deduction")}
                    className="text-red-700 hover:underline"
                  >
                    + Deduction
                  </button>
                </div>
              }
            />
            <div className="text-xs text-ink-muted mb-1">
              Tip: leave Amount at 0 and set a Formula like{" "}
              <code>{`{Basic} * 0.1`}</code> to derive one component from earlier
              ones. Formulas support <code>+ - * / ( )</code> and numeric literals only.
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th className="text-start">Component</th>
                  <th className="text-start w-32">Type</th>
                  <th className="text-end w-28">Amount</th>
                  <th className="text-start">Formula (optional)</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {form.components.map((c, i) => (
                  <tr key={i}>
                    <td>
                      <input
                        className="input"
                        value={c.componentName}
                        onChange={(e) =>
                          updateComponent(i, { componentName: e.target.value })
                        }
                        required
                      />
                    </td>
                    <td>
                      <select
                        className="input"
                        value={c.type}
                        onChange={(e) =>
                          updateComponent(i, {
                            type: e.target.value as Component["type"],
                          })
                        }
                      >
                        <option>Earning</option>
                        <option>Deduction</option>
                      </select>
                    </td>
                    <td>
                      <input
                        type="number"
                        step="any"
                        min={0}
                        className="input text-end disabled:bg-surface-sunken"
                        value={c.amount}
                        disabled={!!c.formula}
                        onChange={(e) =>
                          updateComponent(i, { amount: Number(e.target.value) })
                        }
                      />
                    </td>
                    <td>
                      <input
                        className="input font-mono text-xs"
                        placeholder="e.g. {Basic} * 0.1"
                        value={c.formula}
                        onChange={(e) =>
                          updateComponent(i, { formula: e.target.value })
                        }
                      />
                    </td>
                    <td className="text-end">
                      <button
                        type="button"
                        onClick={() => removeComponent(i)}
                        className="text-red-600 text-xs"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-surface-sunken text-xs">
                <tr>
                  <td className="text-end" colSpan={2}>
                    Gross / Deductions / Net (flat amounts, no formulas):
                  </td>
                  <td className="text-end font-mono tabular-nums">
                    {money(totals.gross)} / {money(totals.ded)} /{" "}
                    <b>{money(totals.net)}</b>
                  </td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            </table>

            <div className="flex justify-end">
              <Button variant="primary" type="submit" disabled={busy}>
                {busy ? "Saving…" : "Save"}
              </Button>
            </div>
          </form>
        </Card>
      )}

      <DataTable<Structure>
        columns={cols}
        rows={rows}
        rowKey={(r) => r.id}
        empty={{ title: "No salary structures yet" }}
      />
    </main>
  );
}
