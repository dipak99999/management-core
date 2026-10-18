"use client";

import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import {
  Button,
  Card,
  PageHeader,
  SectionHeader,
} from "../../components/ui";

interface Named { id: string; name: string }
interface Grade extends Named { defaultBaseSalary: string | null }
interface Branch extends Named { city: string | null; state: string | null }

export default function HRMastersPage() {
  const [grades, setGrades] = useState<Grade[]>([]);
  const [types, setTypes] = useState<Named[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [g, setG] = useState({ name: "", defaultBaseSalary: "" });
  const [t, setT] = useState({ name: "" });
  const [b, setB] = useState({ name: "", city: "", state: "" });

  async function load() {
    try {
      const [gr, tp, br] = await Promise.all([
        api.get<Grade[]>("/employee-grades"),
        api.get<Named[]>("/employment-types"),
        api.get<Branch[]>("/branches"),
      ]);
      setGrades(gr);
      setTypes(tp);
      setBranches(br);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function addGrade(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/employee-grades", {
        name: g.name,
        defaultBaseSalary: g.defaultBaseSalary ? Number(g.defaultBaseSalary) : null,
      });
      setG({ name: "", defaultBaseSalary: "" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function addType(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/employment-types", { name: t.name });
      setT({ name: "" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function addBranch(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/branches", {
        name: b.name,
        city: b.city || null,
        state: b.state || null,
      });
      setB({ name: "", city: "", state: "" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="p-8 space-y-6 max-w-6xl">
      <PageHeader
        breadcrumb={[{ label: "HR & Payroll", href: "/hr" }, { label: "HR masters" }]}
        title="HR masters"
        subtitle="Grades, employment types & branches used across HR forms."
      />

      {error && (
        <Card className="p-4 text-red-700 border-red-200 bg-red-50 text-sm">
          {error}
        </Card>
      )}

      <div className="grid grid-cols-3 gap-4">
        <Card className="p-4">
          <SectionHeader title="Employee grades" />
          <form onSubmit={addGrade} className="flex gap-2 mb-3">
            <input
              className="input flex-1"
              placeholder="Name (e.g. L4)"
              value={g.name}
              onChange={(e) => setG({ ...g, name: e.target.value })}
              required
            />
            <input
              type="number"
              step="0.01"
              className="input w-28"
              placeholder="Base"
              value={g.defaultBaseSalary}
              onChange={(e) => setG({ ...g, defaultBaseSalary: e.target.value })}
            />
            <Button variant="secondary" type="submit" size="sm" disabled={busy}>
              Add
            </Button>
          </form>
          <ul className="space-y-1 text-sm">
            {grades.map((x) => (
              <li key={x.id} className="flex justify-between border-t border-ink-muted/10 py-1 first:border-t-0">
                <span>{x.name}</span>
                <span className="text-xs text-ink-muted tabular-nums">
                  {x.defaultBaseSalary
                    ? Number(x.defaultBaseSalary).toFixed(0)
                    : "—"}
                </span>
              </li>
            ))}
            {grades.length === 0 && (
              <li className="text-ink-muted text-xs">None</li>
            )}
          </ul>
        </Card>

        <Card className="p-4">
          <SectionHeader title="Employment types" />
          <form onSubmit={addType} className="flex gap-2 mb-3">
            <input
              className="input flex-1"
              placeholder="Name (e.g. Full-time)"
              value={t.name}
              onChange={(e) => setT({ name: e.target.value })}
              required
            />
            <Button variant="secondary" type="submit" size="sm" disabled={busy}>
              Add
            </Button>
          </form>
          <ul className="space-y-1 text-sm">
            {types.map((x) => (
              <li key={x.id} className="border-t border-ink-muted/10 py-1 first:border-t-0">
                {x.name}
              </li>
            ))}
            {types.length === 0 && (
              <li className="text-ink-muted text-xs">None</li>
            )}
          </ul>
        </Card>

        <Card className="p-4">
          <SectionHeader title="Branches" />
          <form onSubmit={addBranch} className="space-y-2 mb-3">
            <input
              className="input"
              placeholder="Branch name"
              value={b.name}
              onChange={(e) => setB({ ...b, name: e.target.value })}
              required
            />
            <div className="grid grid-cols-2 gap-1">
              <input
                className="input"
                placeholder="City"
                value={b.city}
                onChange={(e) => setB({ ...b, city: e.target.value })}
              />
              <input
                className="input"
                placeholder="State"
                value={b.state}
                onChange={(e) => setB({ ...b, state: e.target.value })}
              />
            </div>
            <Button variant="secondary" type="submit" size="sm" disabled={busy}>
              Add
            </Button>
          </form>
          <ul className="space-y-1 text-sm">
            {branches.map((x) => (
              <li
                key={x.id}
                className="flex justify-between border-t border-ink-muted/10 py-1 first:border-t-0"
              >
                <span>{x.name}</span>
                <span className="text-xs text-ink-muted">
                  {[x.city, x.state].filter(Boolean).join(", ")}
                </span>
              </li>
            ))}
            {branches.length === 0 && (
              <li className="text-ink-muted text-xs">None</li>
            )}
          </ul>
        </Card>
      </div>
    </main>
  );
}
