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
  Segmented,
  Toast,
  dateShort,
  type Column,
} from "../../components/ui";
import { Icon } from "../../components/app-shell";

// Project Templates — Zoho-Projects-Plus-style. A template is a canned
// project blueprint (name, budget, list of milestones w/ due-offsets, list
// of tasks w/ dependencies + milestone links). Operators build it once and
// "Use template" to spin up a real project seeded with all the structure.

interface MilestoneSpec {
  ref: string;
  name: string;
  dueOffsetDays: number;
}
interface TaskSpec {
  ref: string;
  subject: string;
  description?: string | null;
  expectedHours?: number;
  weight?: number;
  milestoneRef?: string | null;
  dependsOnRefs?: string[];
  startOffsetDays?: number | null;
  endOffsetDays?: number | null;
}
interface StructureJson {
  milestones: MilestoneSpec[];
  tasks: TaskSpec[];
}
interface ProjectTemplate {
  id: string;
  name: string;
  description: string | null;
  billingType: "Fixed" | "Hourly" | "Non-billable";
  defaultBudget: string | number;
  structureJson: StructureJson;
  usageCount: number;
  updatedAt: string;
  createdAt: string;
}

interface Customer { id: string; customerName: string }
interface EmployeeOpt { id: string; employeeCode: string; employeeName: string }

const emptyStructure: StructureJson = { milestones: [], tasks: [] };
const emptyForm = {
  name: "",
  description: "",
  billingType: "Non-billable" as ProjectTemplate["billingType"],
  defaultBudget: 0,
  structureJson: emptyStructure,
};

function nextRef(existing: string[], prefix: "m" | "t"): string {
  // pick the smallest unused `mN` / `tN`
  for (let i = 1; i < 10_000; i++) {
    const cand = `${prefix}${i}`;
    if (!existing.includes(cand)) return cand;
  }
  return `${prefix}${Date.now()}`;
}

export default function ProjectTemplatesPage() {
  const [rows, setRows] = useState<ProjectTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // Editor drawer state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [form, setForm] = useState<typeof emptyForm>(emptyForm);
  const [busy, setBusy] = useState(false);

  // Instantiate drawer state
  const [instantiateFor, setInstantiateFor] = useState<ProjectTemplate | null>(null);
  const [instantiateForm, setInstantiateForm] = useState({
    projectName: "",
    startDate: new Date().toISOString().slice(0, 10),
    customerId: "",
    projectManagerId: "",
    budgetAmount: 0,
    notes: "",
  });
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [employees, setEmployees] = useState<EmployeeOpt[]>([]);
  const [instantiateBusy, setInstantiateBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setRows(await api.get<ProjectTemplate[]>("/project-templates"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  useListPageCommands({
    singular: "Project Template",
    plural: "Project Templates",
    refresh: load,
  });
  async function loadPickerData() {
    try {
      const [cs, es] = await Promise.all([
        api.get<Customer[]>("/customers"),
        api.get<EmployeeOpt[]>("/employees"),
      ]);
      setCustomers(cs);
      setEmployees(es);
    } catch { /* silent — the drawer still works with empty selects */ }
  }

  function openNew() {
    setEditingId(null);
    setForm({ ...emptyForm, structureJson: { milestones: [], tasks: [] } });
    setShowEditor(true);
  }
  function openEdit(t: ProjectTemplate) {
    setEditingId(t.id);
    setForm({
      name: t.name,
      description: t.description ?? "",
      billingType: t.billingType,
      defaultBudget: Number(t.defaultBudget),
      structureJson: {
        milestones: t.structureJson?.milestones ?? [],
        tasks: t.structureJson?.tasks ?? [],
      },
    });
    setShowEditor(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        billingType: form.billingType,
        defaultBudget: Number(form.defaultBudget) || 0,
        structureJson: form.structureJson,
      };
      if (editingId) {
        await api.put(`/project-templates/${editingId}`, payload);
        setMsg("Template updated");
      } else {
        await api.post("/project-templates", payload);
        setMsg("Template created");
      }
      setShowEditor(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove(t: ProjectTemplate) {
    if (!confirm(`Delete template "${t.name}"?`)) return;
    try {
      await api.del(`/project-templates/${t.id}`);
      setMsg("Deleted");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  async function openInstantiate(t: ProjectTemplate) {
    setInstantiateFor(t);
    setInstantiateForm({
      projectName: `${t.name} — ${new Date().toLocaleDateString()}`,
      startDate: new Date().toISOString().slice(0, 10),
      customerId: "",
      projectManagerId: "",
      budgetAmount: Number(t.defaultBudget) || 0,
      notes: "",
    });
    await loadPickerData();
  }

  async function submitInstantiate(e: React.FormEvent) {
    e.preventDefault();
    if (!instantiateFor) return;
    setInstantiateBusy(true);
    try {
      const res = await api.post<{ projectId: string; milestonesCreated: number; tasksCreated: number }>(
        `/project-templates/${instantiateFor.id}/instantiate`,
        {
          projectName: instantiateForm.projectName.trim(),
          startDate: new Date(instantiateForm.startDate).toISOString(),
          customerId: instantiateForm.customerId || null,
          projectManagerId: instantiateForm.projectManagerId || null,
          budgetAmount: Number(instantiateForm.budgetAmount) || 0,
          notes: instantiateForm.notes.trim() || null,
        },
      );
      setMsg(
        `Project created — ${res.milestonesCreated} milestone${res.milestonesCreated === 1 ? "" : "s"} + ${res.tasksCreated} task${res.tasksCreated === 1 ? "" : "s"}.`,
      );
      setInstantiateFor(null);
      // Reload so usage count bumps.
      await load();
      // Redirect to the new project after a short beat so the toast is visible.
      setTimeout(() => {
        window.location.href = `/projects/projects/${res.projectId}`;
      }, 900);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Instantiate failed");
    } finally {
      setInstantiateBusy(false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q
      ? rows.filter((r) =>
          [r.name, r.description].filter(Boolean).some((v) => String(v).toLowerCase().includes(q)),
        )
      : rows;
  }, [rows, search]);

  // ── Editor helpers ──────────────────────────────────────────────────

  function addMilestone() {
    const ref = nextRef(form.structureJson.milestones.map((m) => m.ref), "m");
    setForm({
      ...form,
      structureJson: {
        ...form.structureJson,
        milestones: [
          ...form.structureJson.milestones,
          { ref, name: "New milestone", dueOffsetDays: 7 },
        ],
      },
    });
  }
  function updateMilestone(i: number, patch: Partial<MilestoneSpec>) {
    const next = [...form.structureJson.milestones];
    next[i] = { ...next[i]!, ...patch };
    setForm({ ...form, structureJson: { ...form.structureJson, milestones: next } });
  }
  function removeMilestone(i: number) {
    const removedRef = form.structureJson.milestones[i]?.ref;
    const nextMs = form.structureJson.milestones.filter((_, ix) => ix !== i);
    // Detach tasks pointing at this milestone.
    const nextTs = form.structureJson.tasks.map((t) =>
      t.milestoneRef === removedRef ? { ...t, milestoneRef: null } : t,
    );
    setForm({ ...form, structureJson: { milestones: nextMs, tasks: nextTs } });
  }

  function addTask() {
    const ref = nextRef(form.structureJson.tasks.map((t) => t.ref), "t");
    setForm({
      ...form,
      structureJson: {
        ...form.structureJson,
        tasks: [
          ...form.structureJson.tasks,
          {
            ref,
            subject: "New task",
            expectedHours: 4,
            weight: 1,
            milestoneRef: null,
            dependsOnRefs: [],
            startOffsetDays: 0,
            endOffsetDays: 1,
          },
        ],
      },
    });
  }
  function updateTask(i: number, patch: Partial<TaskSpec>) {
    const next = [...form.structureJson.tasks];
    next[i] = { ...next[i]!, ...patch };
    setForm({ ...form, structureJson: { ...form.structureJson, tasks: next } });
  }
  function removeTask(i: number) {
    const removedRef = form.structureJson.tasks[i]?.ref;
    const nextTs = form.structureJson.tasks
      .filter((_, ix) => ix !== i)
      // Also drop this ref from any depends-on lists.
      .map((t) => ({
        ...t,
        dependsOnRefs: (t.dependsOnRefs ?? []).filter((r) => r !== removedRef),
      }));
    setForm({ ...form, structureJson: { ...form.structureJson, tasks: nextTs } });
  }
  function toggleTaskDep(i: number, depRef: string) {
    const t = form.structureJson.tasks[i]!;
    const has = (t.dependsOnRefs ?? []).includes(depRef);
    const nextDeps = has
      ? (t.dependsOnRefs ?? []).filter((r) => r !== depRef)
      : [...(t.dependsOnRefs ?? []), depRef];
    updateTask(i, { dependsOnRefs: nextDeps });
  }

  const columns: Column<ProjectTemplate>[] = [
    {
      header: "Name",
      cell: (t) => (
        <button
          onClick={() => openEdit(t)}
          className="font-medium text-ink hover:text-brand-700 text-start"
        >
          {t.name}
        </button>
      ),
    },
    {
      header: "Description",
      cell: (t) => (
        <span className="text-ink-muted text-sm truncate max-w-md block">
          {t.description ?? "—"}
        </span>
      ),
    },
    { header: "Billing", cell: (t) => <span className="badge-gray">{t.billingType}</span> },
    {
      header: "Milestones",
      align: "right",
      cell: (t) => (
        <span className="tabular-nums text-ink-soft">
          {t.structureJson?.milestones?.length ?? 0}
        </span>
      ),
    },
    {
      header: "Tasks",
      align: "right",
      cell: (t) => (
        <span className="tabular-nums text-ink-soft">
          {t.structureJson?.tasks?.length ?? 0}
        </span>
      ),
    },
    {
      header: "Uses",
      align: "right",
      cell: (t) => <span className="tabular-nums text-ink-soft">{t.usageCount}</span>,
    },
    {
      header: "Updated",
      cell: (t) => <span className="text-ink-muted text-xs">{dateShort(t.updatedAt)}</span>,
    },
    {
      header: "",
      align: "right",
      cell: (t) => (
        <div className="flex items-center gap-2 justify-end">
          <button
            onClick={() => openInstantiate(t)}
            className="text-xs text-brand-600 hover:underline"
          >
            Use template
          </button>
          <button onClick={() => openEdit(t)} className="text-xs text-ink-soft hover:text-brand-700">
            Edit
          </button>
          <button onClick={() => remove(t)} className="text-xs text-red-600 hover:underline">
            Delete
          </button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Home", href: "/" }, { label: "Project Templates" }]}
        title="Project Templates"
        subtitle={`${rows.length} template${rows.length === 1 ? "" : "s"} · seed a whole project (milestones + tasks + dependencies) in one click`}
        actions={<Button variant="brand" onClick={openNew}>+ New Template</Button>}
      />

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}
      {msg && <div className="mb-4"><Toast kind="success" message={msg} onDismiss={() => setMsg(null)} /></div>}

      <div className="space-y-4">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search templates…" }}
          actions={<SavedViewsControls listKey="projects-web:project-templates" current={{ search }} onApply={(fv) => setSearch(fv.search)} />}
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(t) => t.id}
          loading={loading}
          empty={{
            icon: Icon.layers,
            title: search ? "No matches" : "No project templates yet",
            description: search
              ? "Try a different search."
              : "Build a template once and spin up a fully-structured project in one click every time.",
            action: !search && <Button variant="brand" onClick={openNew}>+ New Template</Button>,
          }}
        />
      </div>

      {/* ─── Editor drawer ─────────────────────────────────────────── */}
      <Drawer
        open={showEditor}
        onClose={() => setShowEditor(false)}
        title={editingId ? "Edit template" : "New project template"}
        width="w-[820px]"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowEditor(false)}>Cancel</Button>
            <Button
              variant="brand"
              onClick={(e) => save(e as unknown as React.FormEvent)}
              disabled={busy || !form.name.trim()}
            >
              {busy ? "Saving…" : editingId ? "Save changes" : "Create template"}
            </Button>
          </>
        }
      >
        <form onSubmit={save} className="space-y-5">
          {/* Basics */}
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Name" required>
              <input
                className="input"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Website launch"
                required
                autoFocus
              />
            </FormField>
            <FormField label="Billing type">
              <Segmented
                value={form.billingType}
                onChange={(v) => setForm({ ...form, billingType: v })}
                options={[
                  { value: "Fixed",        label: "Fixed" },
                  { value: "Hourly",       label: "Hourly" },
                  { value: "Non-billable", label: "Non-bill" },
                ]}
              />
            </FormField>
          </div>
          <FormField label="Description">
            <input
              className="input"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Optional"
            />
          </FormField>
          <FormField label="Default budget">
            <input
              type="number"
              min={0}
              step="0.01"
              className="input"
              value={form.defaultBudget}
              onChange={(e) => setForm({ ...form, defaultBudget: Number(e.target.value) || 0 })}
            />
          </FormField>

          {/* Milestones editor */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="label mb-0">
                Milestones{" "}
                <span className="text-ink-muted font-normal">
                  ({form.structureJson.milestones.length})
                </span>
              </label>
              <button type="button" onClick={addMilestone} className="text-xs text-brand-600 hover:underline">
                + Add milestone
              </button>
            </div>
            {form.structureJson.milestones.length === 0 ? (
              <div className="card p-3 text-xs text-ink-muted text-center">
                No milestones yet.
              </div>
            ) : (
              <div className="card overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-surface-sunken text-ink-muted">
                    <tr>
                      <th className="px-3 py-2 text-start text-[11px] uppercase font-semibold w-16">Ref</th>
                      <th className="px-3 py-2 text-start text-[11px] uppercase font-semibold">Name</th>
                      <th className="px-3 py-2 text-end text-[11px] uppercase font-semibold w-32">Due (days)</th>
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {form.structureJson.milestones.map((m, i) => (
                      <tr key={m.ref} className="border-t border-ink-muted/10">
                        <td className="px-2 py-1">
                          <input
                            className="input input-sm font-mono"
                            value={m.ref}
                            onChange={(e) => updateMilestone(i, { ref: e.target.value.trim() })}
                          />
                        </td>
                        <td className="px-2 py-1">
                          <input
                            className="input input-sm"
                            value={m.name}
                            onChange={(e) => updateMilestone(i, { name: e.target.value })}
                          />
                        </td>
                        <td className="px-2 py-1">
                          <input
                            type="number"
                            min={0}
                            className="input input-sm text-end"
                            value={m.dueOffsetDays}
                            onChange={(e) => updateMilestone(i, { dueOffsetDays: Number(e.target.value) || 0 })}
                          />
                        </td>
                        <td className="px-2 py-1 text-end">
                          <button
                            type="button"
                            onClick={() => removeMilestone(i)}
                            className="text-xs text-red-600 hover:underline"
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Tasks editor */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="label mb-0">
                Tasks{" "}
                <span className="text-ink-muted font-normal">
                  ({form.structureJson.tasks.length})
                </span>
              </label>
              <button type="button" onClick={addTask} className="text-xs text-brand-600 hover:underline">
                + Add task
              </button>
            </div>
            {form.structureJson.tasks.length === 0 ? (
              <div className="card p-3 text-xs text-ink-muted text-center">
                No tasks yet.
              </div>
            ) : (
              <div className="space-y-2">
                {form.structureJson.tasks.map((t, i) => (
                  <div key={t.ref} className="card p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <input
                        className="input input-sm font-mono w-16"
                        value={t.ref}
                        onChange={(e) => updateTask(i, { ref: e.target.value.trim() })}
                      />
                      <input
                        className="input input-sm flex-1"
                        placeholder="Task subject"
                        value={t.subject}
                        onChange={(e) => updateTask(i, { subject: e.target.value })}
                      />
                      <button
                        type="button"
                        onClick={() => removeTask(i)}
                        className="text-xs text-red-600 hover:underline"
                      >
                        Remove
                      </button>
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      <div>
                        <div className="text-[10px] uppercase text-ink-muted mb-1">Milestone</div>
                        <select
                          className="input input-sm"
                          value={t.milestoneRef ?? ""}
                          onChange={(e) => updateTask(i, { milestoneRef: e.target.value || null })}
                        >
                          <option value="">— none —</option>
                          {form.structureJson.milestones.map((m) => (
                            <option key={m.ref} value={m.ref}>{m.name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase text-ink-muted mb-1">Hours</div>
                        <input
                          type="number"
                          min={0}
                          step="0.5"
                          className="input input-sm text-end"
                          value={t.expectedHours ?? 0}
                          onChange={(e) => updateTask(i, { expectedHours: Number(e.target.value) || 0 })}
                        />
                      </div>
                      <div>
                        <div className="text-[10px] uppercase text-ink-muted mb-1">Start (days)</div>
                        <input
                          type="number"
                          min={0}
                          className="input input-sm text-end"
                          value={t.startOffsetDays ?? 0}
                          onChange={(e) => updateTask(i, { startOffsetDays: Number(e.target.value) || 0 })}
                        />
                      </div>
                      <div>
                        <div className="text-[10px] uppercase text-ink-muted mb-1">End (days)</div>
                        <input
                          type="number"
                          min={0}
                          className="input input-sm text-end"
                          value={t.endOffsetDays ?? 0}
                          onChange={(e) => updateTask(i, { endOffsetDays: Number(e.target.value) || 0 })}
                        />
                      </div>
                    </div>
                    {form.structureJson.tasks.length > 1 && (
                      <div>
                        <div className="text-[10px] uppercase text-ink-muted mb-1">Depends on</div>
                        <div className="flex flex-wrap gap-1.5">
                          {form.structureJson.tasks
                            .filter((other) => other.ref !== t.ref)
                            .map((other) => {
                              const active = (t.dependsOnRefs ?? []).includes(other.ref);
                              return (
                                <button
                                  key={other.ref}
                                  type="button"
                                  onClick={() => toggleTaskDep(i, other.ref)}
                                  className={active ? "badge-brand" : "badge-gray hover:badge-brand"}
                                >
                                  {other.ref} · {other.subject.slice(0, 24)}
                                </button>
                              );
                            })}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <button type="submit" className="hidden" />
        </form>
      </Drawer>

      {/* ─── Instantiate drawer ────────────────────────────────────── */}
      <Drawer
        open={!!instantiateFor}
        onClose={() => setInstantiateFor(null)}
        title={instantiateFor ? `Use template: ${instantiateFor.name}` : "Use template"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setInstantiateFor(null)}>Cancel</Button>
            <Button
              variant="brand"
              onClick={(e) => submitInstantiate(e as unknown as React.FormEvent)}
              disabled={instantiateBusy || !instantiateForm.projectName.trim()}
            >
              {instantiateBusy ? "Creating…" : "Create project"}
            </Button>
          </>
        }
      >
        <form onSubmit={submitInstantiate} className="space-y-4">
          {instantiateFor && (
            <div className="text-xs text-ink-muted card p-3">
              This will create <strong className="text-ink">{instantiateFor.structureJson?.milestones?.length ?? 0}</strong> milestones and{" "}
              <strong className="text-ink">{instantiateFor.structureJson?.tasks?.length ?? 0}</strong> tasks, with dependencies wired up.
            </div>
          )}
          <FormField label="Project name" required>
            <input
              className="input"
              value={instantiateForm.projectName}
              onChange={(e) => setInstantiateForm({ ...instantiateForm, projectName: e.target.value })}
              required
              autoFocus
            />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Start date" required>
              <input
                type="date"
                className="input"
                value={instantiateForm.startDate}
                onChange={(e) => setInstantiateForm({ ...instantiateForm, startDate: e.target.value })}
                required
              />
            </FormField>
            <FormField label="Budget">
              <input
                type="number"
                min={0}
                step="0.01"
                className="input"
                value={instantiateForm.budgetAmount}
                onChange={(e) => setInstantiateForm({ ...instantiateForm, budgetAmount: Number(e.target.value) || 0 })}
              />
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Customer">
              <select
                className="input"
                value={instantiateForm.customerId}
                onChange={(e) => setInstantiateForm({ ...instantiateForm, customerId: e.target.value })}
              >
                <option value="">— none —</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.customerName}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Project manager">
              <select
                className="input"
                value={instantiateForm.projectManagerId}
                onChange={(e) => setInstantiateForm({ ...instantiateForm, projectManagerId: e.target.value })}
              >
                <option value="">— none —</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>{e.employeeName}</option>
                ))}
              </select>
            </FormField>
          </div>
          <FormField label="Notes">
            <textarea
              className="input min-h-[80px]"
              value={instantiateForm.notes}
              onChange={(e) => setInstantiateForm({ ...instantiateForm, notes: e.target.value })}
              placeholder="Optional context for the team"
            />
          </FormField>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </>
  );
}
