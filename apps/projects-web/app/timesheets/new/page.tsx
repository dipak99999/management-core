"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "../../../lib/api";
import {
  Button,
  Card,
  FormField,
  PageHeader,
  SectionHeader,
  Toast,
} from "../../../components/ui";
import { useOptionalUIBackends, useSmartDefaults } from "@lumaara/web-ui";

interface Employee { id: string; employeeCode: string; employeeName: string }
interface Project { id: string; name: string; projectName: string; billingType: string }
interface Task {
  id: string;
  subject: string;
  projectId: string;
  project: { id: string; name: string; projectName: string };
}

interface Line {
  projectId: string;
  taskId: string;
  date: string; // YYYY-MM-DD
  hours: number;
  isBillable: boolean;
  billingRate: number;
  description: string;
}

const emptyLine: Line = {
  projectId: "",
  taskId: "",
  date: new Date().toISOString().slice(0, 10),
  hours: 0,
  isBillable: false,
  billingRate: 0,
  description: "",
};

// Compute the Monday of the week containing d (informational — server just stores whatever we send).
function mondayOf(d: Date): string {
  const day = d.getDay(); // 0 = Sun
  const diff = day === 0 ? -6 : 1 - day;
  const m = new Date(d);
  m.setDate(m.getDate() + diff);
  return m.toISOString().slice(0, 10);
}

export default function NewTimesheetPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [weekStartDate, setWeekStartDate] = useState(mondayOf(new Date()));
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([{ ...emptyLine }]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<Employee[]>("/employees").then(setEmployees).catch(() => {});
    api.get<Project[]>("/projects").then(setProjects).catch(() => {});
    api.get<Task[]>("/tasks").then(setTasks).catch(() => {});
  }, []);

  // Smart defaults: pre-fill employee + the most recent project onto the
  // first blank line so repeat timesheets are one-click.
  const uiBackends = useOptionalUIBackends();
  const smart = useSmartDefaults<{ employeeId: string; projectId: string }>(
    "projects-web:timesheet-create",
    uiBackends?.defaults,
  );
  useEffect(() => {
    if (employeeId || !smart.last) return;
    if (smart.last.employeeId) setEmployeeId(smart.last.employeeId);
    if (smart.last.projectId) {
      setLines((ls) =>
        ls.map((l, i) => (i === 0 && !l.projectId ? { ...l, projectId: smart.last!.projectId } : l)),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [smart.last?.employeeId, smart.last?.projectId]);

  function updateLine(i: number, patch: Partial<Line>) {
    setLines((ls) =>
      ls.map((l, idx) => {
        if (idx !== i) return l;
        const next = { ...l, ...patch };
        // If project changed, clear task (may not belong to new project).
        if (patch.projectId !== undefined && patch.projectId !== l.projectId) {
          next.taskId = "";
        }
        return next;
      }),
    );
  }

  const totals = useMemo(() => {
    let hours = 0;
    let billableHours = 0;
    let billingAmount = 0;
    for (const l of lines) {
      const h = Number(l.hours) || 0;
      hours += h;
      if (l.isBillable) {
        billableHours += h;
        billingAmount += h * Number(l.billingRate || 0);
      }
    }
    return { hours, billableHours, billingAmount };
  }, [lines]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post("/timesheets", {
        employeeId,
        weekStartDate: new Date(weekStartDate).toISOString(),
        notes: notes || null,
        lines: lines
          .filter((l) => l.projectId && l.hours > 0)
          .map((l) => ({
            projectId: l.projectId,
            taskId: l.taskId || null,
            date: new Date(l.date).toISOString(),
            hours: l.hours,
            isBillable: l.isBillable,
            billingRate: l.billingRate,
            description: l.description || null,
          })),
      });
      // Remember employee + the first project across sessions.
      const firstProject = lines.find((l) => l.projectId)?.projectId ?? "";
      smart.remember({ employeeId, projectId: firstProject });
      window.location.href = "/projects/timesheets";
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        breadcrumb={[
          { label: "Timesheets", href: "/projects/timesheets" },
          { label: "New" },
        ]}
        title="New Timesheet"
        subtitle="Log hours per project and task for a work week."
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => history.back()}
              type="button"
            >
              ← Back
            </Button>
            <Button
              variant="brand"
              onClick={(e) => submit(e as unknown as React.FormEvent)}
              disabled={busy}
              type="button"
            >
              {busy ? "Saving…" : "Save (as Draft)"}
            </Button>
          </>
        }
      />

      {error && (
        <div className="mb-4">
          <Toast kind="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      <form onSubmit={submit} className="space-y-4">
        <Card className="p-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Employee" required>
              <select
                required
                className="input"
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
              >
                <option value="">Select employee…</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.employeeName} ({emp.employeeCode})
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Week starting (Mon)" required>
              <input
                required
                type="date"
                className="input"
                value={weekStartDate}
                onChange={(e) => setWeekStartDate(e.target.value)}
              />
            </FormField>
          </div>
        </Card>

        <Card className="p-4 space-y-3">
          <SectionHeader
            title="Lines"
            actions={
              <Button
                variant="ghost"
                size="sm"
                type="button"
                onClick={() => setLines([...lines, { ...emptyLine, date: weekStartDate }])}
              >
                + Add line
              </Button>
            }
          />
          <div className="table-wrap overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: "9rem" }}>Date</th>
                  <th style={{ width: "12rem" }}>Project</th>
                  <th style={{ width: "12rem" }}>Task</th>
                  <th className="text-end" style={{ width: "5rem" }}>Hours</th>
                  <th className="text-center" style={{ width: "4rem" }}>Bill</th>
                  <th className="text-end" style={{ width: "6rem" }}>Rate</th>
                  <th>Description</th>
                  <th style={{ width: "2rem" }} />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => {
                  const filteredTasks = tasks.filter(
                    (t) => !l.projectId || t.projectId === l.projectId,
                  );
                  return (
                    <tr key={i}>
                      <td>
                        <input
                          type="date"
                          required
                          className="input input-sm"
                          value={l.date}
                          onChange={(e) => updateLine(i, { date: e.target.value })}
                        />
                      </td>
                      <td>
                        <select
                          required
                          className="input input-sm"
                          value={l.projectId}
                          onChange={(e) => updateLine(i, { projectId: e.target.value })}
                        >
                          <option value="">Select…</option>
                          {projects.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.projectName}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select
                          className="input input-sm"
                          value={l.taskId}
                          onChange={(e) => updateLine(i, { taskId: e.target.value })}
                          disabled={!l.projectId}
                        >
                          <option value="">(no task)</option>
                          {filteredTasks.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.subject}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="text-end">
                        <input
                          type="number"
                          step="0.25"
                          min={0}
                          required
                          className="input input-sm text-end tabular-nums"
                          value={l.hours}
                          onChange={(e) => updateLine(i, { hours: Number(e.target.value) })}
                        />
                      </td>
                      <td className="text-center">
                        <input
                          type="checkbox"
                          checked={l.isBillable}
                          onChange={(e) => updateLine(i, { isBillable: e.target.checked })}
                        />
                      </td>
                      <td className="text-end">
                        <input
                          type="number"
                          step="any"
                          min={0}
                          className="input input-sm text-end tabular-nums disabled:bg-surface-sunken"
                          disabled={!l.isBillable}
                          value={l.billingRate}
                          onChange={(e) => updateLine(i, { billingRate: Number(e.target.value) })}
                        />
                      </td>
                      <td>
                        <input
                          className="input input-sm"
                          value={l.description}
                          onChange={(e) => updateLine(i, { description: e.target.value })}
                          placeholder="Notes (optional)"
                        />
                      </td>
                      <td className="text-end">
                        <button
                          type="button"
                          onClick={() => setLines(lines.filter((_, idx) => idx !== i))}
                          className="text-red-600 text-xs"
                          aria-label="Remove line"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-surface-sunken text-sm font-semibold">
                <tr>
                  <td colSpan={3} className="text-end">Totals</td>
                  <td className="text-end tabular-nums">
                    {totals.hours.toFixed(2)}
                  </td>
                  <td colSpan={2} className="text-end tabular-nums">
                    {totals.billableHours.toFixed(2)} bill · {totals.billingAmount.toFixed(2)}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>

        <Card className="p-4">
          <FormField label="Notes">
            <textarea
              className="input min-h-[80px]"
              placeholder="Optional notes for reviewers"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </FormField>
        </Card>

        <div className="flex justify-end">
          <Button variant="brand" type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save (as Draft)"}
          </Button>
        </div>
      </form>
    </>
  );
}
