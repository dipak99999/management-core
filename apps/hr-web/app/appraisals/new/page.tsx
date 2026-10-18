"use client";

import { useEffect, useState } from "react";
import { useOptionalUIBackends, useSmartDefaults } from "@lumaara/web-ui";
import { api } from "../../../lib/api";
import {
  Button,
  Card,
  FormField,
  PageHeader,
  SectionHeader,
} from "../../../components/ui";

interface Employee {
  id: string;
  employeeCode: string;
  employeeName: string;
}
interface Template {
  id: string;
  name: string;
  _count: { goals: number };
}
interface GoalRow {
  kra: string;
  description: string;
  weightPercent: string;
}

const emptyGoal: GoalRow = { kra: "", description: "", weightPercent: "" };

export default function NewAppraisalPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [form, setForm] = useState({
    employeeId: "",
    templateId: "",
    periodStart: "",
    periodEnd: "",
    employeeRemarks: "",
  });
  const [goals, setGoals] = useState<GoalRow[]>([{ ...emptyGoal }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Smart defaults: HR usually launches many appraisals using the same
  // template + review period. Pre-fill template + period dates.
  const uiBackends = useOptionalUIBackends();
  const smart = useSmartDefaults<{ templateId: string; periodStart: string; periodEnd: string }>(
    "hr-web:appraisal-create",
    uiBackends?.defaults,
  );
  useEffect(() => {
    if (!smart.last) return;
    setForm((f) => ({
      ...f,
      templateId: f.templateId || smart.last!.templateId || f.templateId,
      periodStart: f.periodStart || smart.last!.periodStart || f.periodStart,
      periodEnd: f.periodEnd || smart.last!.periodEnd || f.periodEnd,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [smart.last?.templateId, smart.last?.periodStart, smart.last?.periodEnd]);

  useEffect(() => {
    (async () => {
      try {
        const [es, ts] = await Promise.all([
          api.get<Employee[]>("/employees"),
          api.get<Template[]>("/appraisal-templates"),
        ]);
        setEmployees(es);
        setTemplates(ts);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed");
      }
    })();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        employeeId: form.employeeId,
        periodStart: new Date(form.periodStart).toISOString(),
        periodEnd: new Date(form.periodEnd).toISOString(),
        employeeRemarks: form.employeeRemarks || null,
      };
      if (form.templateId) {
        payload.templateId = form.templateId;
      } else {
        payload.goals = goals
          .filter((g) => g.kra.trim())
          .map((g, i) => ({
            kra: g.kra,
            description: g.description || null,
            weightPercent: Number(g.weightPercent),
            sortOrder: i,
          }));
      }
      const r = await api.post<{ id: string }>("/appraisals", payload);
      smart.remember({
        templateId: form.templateId,
        periodStart: form.periodStart,
        periodEnd: form.periodEnd,
      });
      window.location.href = `/hr/appraisals/${r.id}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const totalWeight = goals.reduce((s, g) => s + Number(g.weightPercent || 0), 0);

  return (
    <main className="p-8 space-y-6 max-w-3xl">
      <PageHeader
        breadcrumb={[
          { label: "Appraisals", href: "/hr/appraisals" },
          { label: "New" },
        ]}
        title="New appraisal"
        actions={
          <Button
            variant="secondary"
            onClick={() => history.back()}
            type="button"
          >
            ← Back
          </Button>
        }
      />

      {error && (
        <Card className="p-4 text-red-700 border-red-200 bg-red-50 text-sm">
          {error}
        </Card>
      )}

      <Card className="p-6">
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Employee" required>
              <select
                className="input"
                value={form.employeeId}
                onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
                required
              >
                <option value="">Choose…</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.employeeCode} — {e.employeeName}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Template (optional)">
              <select
                className="input"
                value={form.templateId}
                onChange={(e) => setForm({ ...form, templateId: e.target.value })}
              >
                <option value="">(ad-hoc goals below)</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t._count.goals} goals)
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Period start" required>
              <input
                type="date"
                className="input"
                value={form.periodStart}
                onChange={(e) => setForm({ ...form, periodStart: e.target.value })}
                required
              />
            </FormField>
            <FormField label="Period end" required>
              <input
                type="date"
                className="input"
                value={form.periodEnd}
                onChange={(e) => setForm({ ...form, periodEnd: e.target.value })}
                required
              />
            </FormField>
          </div>

          {!form.templateId && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <SectionHeader
                  title={
                    <span>
                      Goals{" "}
                      <span
                        className={`ms-2 text-xs ${
                          Math.abs(totalWeight - 100) < 0.01
                            ? "text-green-700"
                            : "text-red-600"
                        }`}
                      >
                        Weight total: {totalWeight.toFixed(1)}%
                      </span>
                    </span>
                  }
                  actions={
                    <button
                      type="button"
                      onClick={() => setGoals([...goals, { ...emptyGoal }])}
                      className="text-xs text-brand-600 hover:underline"
                    >
                      + Add goal
                    </button>
                  }
                />
              </div>
              <table className="table">
                <thead>
                  <tr>
                    <th className="text-start">KRA</th>
                    <th className="text-start">Description</th>
                    <th className="text-end">Weight %</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {goals.map((g, i) => (
                    <tr key={i}>
                      <td>
                        <input
                          className="input"
                          value={g.kra}
                          onChange={(e) =>
                            setGoals((rows) =>
                              rows.map((x, idx) =>
                                idx === i ? { ...x, kra: e.target.value } : x,
                              ),
                            )
                          }
                        />
                      </td>
                      <td>
                        <input
                          className="input"
                          value={g.description}
                          onChange={(e) =>
                            setGoals((rows) =>
                              rows.map((x, idx) =>
                                idx === i
                                  ? { ...x, description: e.target.value }
                                  : x,
                              ),
                            )
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          className="input text-end w-24"
                          value={g.weightPercent}
                          onChange={(e) =>
                            setGoals((rows) =>
                              rows.map((x, idx) =>
                                idx === i
                                  ? { ...x, weightPercent: e.target.value }
                                  : x,
                              ),
                            )
                          }
                        />
                      </td>
                      <td className="text-end">
                        <button
                          type="button"
                          className="text-red-500 text-xs"
                          onClick={() =>
                            setGoals((rows) =>
                              rows.filter((_, idx) => idx !== i),
                            )
                          }
                        >
                          remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <FormField label="Employee remarks (optional)">
            <textarea
              className="input"
              value={form.employeeRemarks}
              onChange={(e) =>
                setForm({ ...form, employeeRemarks: e.target.value })
              }
            />
          </FormField>

          <div className="flex justify-end">
            <Button variant="primary" type="submit" disabled={busy}>
              {busy ? "Saving…" : "Create draft"}
            </Button>
          </div>
        </form>
      </Card>
    </main>
  );
}
