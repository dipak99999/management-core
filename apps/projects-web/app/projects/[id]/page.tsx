"use client";

import { useEffect, useMemo, useState } from "react";
import { DocActivityPanel } from "@lumaara/web-ui";
import { useParams } from "next/navigation";
import { api } from "../../../lib/api";
import { WorkflowActions } from "../../../lib/workflow-actions";
import { AttachmentsPanel } from "../../../lib/attachments";
import { CommentsPanel } from "../../../lib/comments";
import { currentUserId } from "../../../lib/collab-api";
import {
  Button,
  Card,
  DataTable,
  Drawer,
  FormField,
  PageHeader,
  Segmented,
  Skeleton,
  StatusBadge,
  Toast,
  dateShort,
  type Column,
} from "../../../components/ui";

// ── Types ─────────────────────────────────────────────────────────────

interface Employee { id: string; employeeCode: string; employeeName: string }
interface Task {
  id: string;
  subject: string;
  status: string;
  priority: string;
  expectedHours: string;
  actualHours: string;
  dueDate?: string | null;
  endDate?: string | null;
  startDate?: string | null;
  progressPct?: number | null;
  weight?: number | null;
  parentTaskId?: string | null;
  milestoneId?: string | null;
  assignedEmployee: Employee | null;
}
interface Project {
  id: string;
  name: string;
  projectName: string;
  status: string;
  billingType: string;
  startDate: string | null;
  endDate: string | null;
  estimatedCost: string;
  actualCost: string;
  notes: string | null;
  budgetAmount?: string | number | null;
  budgetThresholdPct?: string | number | null;
  budgetSpent?: string | number | null;
  fromTemplateId?: string | null;
  customer: { id: string; customerName: string } | null;
  projectManager: Employee | null;
  tasks: Task[];
}
interface RecentLine {
  id: string;
  date: string;
  hours: string;
  isBillable: boolean;
  billingAmount: string;
  timesheet: {
    id: string;
    name: string;
    status: string;
    employee: Employee;
  };
  task: { id: string; subject: string } | null;
}
interface Payload {
  project: Project;
  stats: {
    totalTasks: number;
    openTasks: number;
    completedTasks: number;
    plannedHours: number;
    loggedHours: number;
  };
  recentLines: RecentLine[];
}

type MilestoneStatus = "Upcoming" | "InProgress" | "Completed" | "Missed";
interface Milestone {
  id: string;
  projectId: string;
  name: string;
  description?: string | null;
  dueDate?: string | null;
  status: MilestoneStatus;
  order?: number | null;
}

type TabKey = "overview" | "tasks" | "milestones" | "gantt" | "budget";

const MILESTONE_BADGE: Record<MilestoneStatus, string> = {
  Upcoming:  "badge-blue",
  InProgress: "badge-amber",
  Completed: "badge-green",
  Missed:    "badge-red",
};

// Small helper — matches ProgressBar spec (bg-brand-100 + bg-brand-gradient).
function ProgressBar({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  return (
    <div className="card p-1 bg-brand-100 h-2 rounded-full overflow-hidden">
      <div
        className="h-full bg-brand-gradient rounded-full transition-all"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

function num(v: unknown): number {
  if (v == null || v === "") return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

// ── Page ──────────────────────────────────────────────────────────────

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;

  const [data, setData] = useState<Payload | null>(null);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("overview");

  // Drawers
  const [msDrawer, setMsDrawer] = useState<{ open: boolean; editing?: Milestone | null }>({ open: false });
  const [budgetDrawer, setBudgetDrawer] = useState(false);
  const [taskDrawer, setTaskDrawer] = useState<{ open: boolean; parentTaskId?: string; milestoneId?: string }>({ open: false });

  // Milestone form
  const emptyMs = { name: "", description: "", dueDate: "", status: "Upcoming" as MilestoneStatus };
  const [msForm, setMsForm] = useState(emptyMs);

  // Budget form
  const [budgetForm, setBudgetForm] = useState({ budgetAmount: 0, budgetThresholdPct: 80 });

  // Task form
  const emptyTask = {
    subject: "",
    description: "",
    status: "Open" as "Open" | "InProgress" | "Completed" | "Cancelled",
    priority: "Medium" as "Low" | "Medium" | "High" | "Urgent",
    expectedHours: 0,
    weight: 1,
    milestoneId: "",
    parentTaskId: "" as string | undefined,
  };
  const [taskForm, setTaskForm] = useState(emptyTask);

  async function load() {
    try {
      const [d, ms] = await Promise.all([
        api.get<Payload>(`/projects/${projectId}/full`),
        api.get<Milestone[]>(`/milestones?projectId=${projectId}`).catch(() => [] as Milestone[]),
      ]);
      setData(d);
      setMilestones(ms);
      const p = d.project;
      setBudgetForm({
        budgetAmount: num(p.budgetAmount),
        budgetThresholdPct: num(p.budgetThresholdPct) || 80,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // ── Milestone CRUD ─────────────────────────────────────────────────
  function openNewMs() {
    setMsForm(emptyMs);
    setMsDrawer({ open: true, editing: null });
  }
  function openEditMs(m: Milestone) {
    setMsForm({
      name: m.name,
      description: m.description ?? "",
      dueDate: m.dueDate ? m.dueDate.slice(0, 10) : "",
      status: m.status,
    });
    setMsDrawer({ open: true, editing: m });
  }
  async function saveMs() {
    try {
      const body = {
        projectId,
        name: msForm.name,
        description: msForm.description || null,
        dueDate: msForm.dueDate ? new Date(msForm.dueDate).toISOString() : null,
        status: msForm.status,
      };
      if (msDrawer.editing) {
        await api.put(`/milestones/${msDrawer.editing.id}`, body);
      } else {
        await api.post(`/milestones`, body);
      }
      setMsDrawer({ open: false });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  async function delMs(m: Milestone) {
    if (!confirm(`Delete milestone "${m.name}"?`)) return;
    try {
      await api.del(`/milestones/${m.id}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  // ── Task quick-add ─────────────────────────────────────────────────
  function openAddTask(opts?: { milestoneId?: string; parentTaskId?: string }) {
    setTaskForm({ ...emptyTask, milestoneId: opts?.milestoneId ?? "", parentTaskId: opts?.parentTaskId });
    setTaskDrawer({ open: true, ...opts });
  }
  async function saveTask() {
    try {
      await api.post(`/tasks`, {
        projectId,
        subject: taskForm.subject,
        description: taskForm.description || null,
        status: taskForm.status,
        priority: taskForm.priority,
        expectedHours: taskForm.expectedHours,
        weight: taskForm.weight,
        milestoneId: taskForm.milestoneId || null,
        parentTaskId: taskForm.parentTaskId || null,
      });
      setTaskDrawer({ open: false });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  // ── Budget update ──────────────────────────────────────────────────
  async function saveBudget() {
    try {
      await api.put(`/projects/${projectId}`, {
        budgetAmount: budgetForm.budgetAmount,
        budgetThresholdPct: budgetForm.budgetThresholdPct,
      });
      setBudgetDrawer(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  // ── Derived structures ─────────────────────────────────────────────
  const tasksByMilestone = useMemo(() => {
    const grouped: Record<string, Task[]> = {};
    const unassigned: Task[] = [];
    if (!data) return { grouped, unassigned };
    for (const t of data.project.tasks) {
      // We only show top-level tasks here; subtasks nest under their parent.
      if (t.parentTaskId) continue;
      if (t.milestoneId) {
        (grouped[t.milestoneId] ||= []).push(t);
      } else {
        unassigned.push(t);
      }
    }
    return { grouped, unassigned };
  }, [data]);

  const childrenByParent = useMemo(() => {
    const map: Record<string, Task[]> = {};
    if (!data) return map;
    for (const t of data.project.tasks) {
      if (t.parentTaskId) (map[t.parentTaskId] ||= []).push(t);
    }
    return map;
  }, [data]);

  const milestoneTaskCount = useMemo(() => {
    const counts: Record<string, number> = {};
    if (!data) return counts;
    for (const t of data.project.tasks) {
      if (t.milestoneId) counts[t.milestoneId] = (counts[t.milestoneId] || 0) + 1;
    }
    return counts;
  }, [data]);

  if (error && !data) {
    return (
      <>
        <PageHeader
          breadcrumb={[{ label: "Projects", href: "/projects/projects" }]}
          title="Project"
          actions={
            <Button variant="secondary" onClick={() => history.back()} type="button">
              ← Back
            </Button>
          }
        />
        <Card className="p-4 text-red-700 border-red-200 bg-red-50">{error}</Card>
      </>
    );
  }
  if (!data) {
    return (
      <>
        <PageHeader
          breadcrumb={[{ label: "Projects", href: "/projects/projects" }]}
          title="Loading…"
        />
        <div className="grid grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20" rounded="rounded-lg" />
          ))}
        </div>
      </>
    );
  }
  const p = data.project;
  const budgetAmt = num(p.budgetAmount);
  const budgetSpent = num(p.budgetSpent);
  const budgetThreshold = num(p.budgetThresholdPct) || 80;
  const budgetUtil = budgetAmt > 0 ? (budgetSpent / budgetAmt) * 100 : 0;
  const budgetRemaining = budgetAmt - budgetSpent;
  const overThreshold = budgetAmt > 0 && budgetUtil >= budgetThreshold;

  const msColumns: Column<Milestone>[] = [
    { header: "Name", cell: (m) => <span className="font-medium text-ink">{m.name}</span> },
    { header: "Due", cell: (m) => <span className="text-ink-soft text-xs">{dateShort(m.dueDate)}</span> },
    { header: "Status", cell: (m) => <span className={MILESTONE_BADGE[m.status] ?? "badge-gray"}>{m.status}</span> },
    { header: "Tasks", align: "right", cell: (m) => <span className="tabular-nums">{milestoneTaskCount[m.id] || 0}</span> },
    {
      header: "",
      align: "right",
      cell: (m) => (
        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="sm" onClick={() => openEditMs(m)}>Edit</Button>
          <Button variant="ghost" size="sm" onClick={() => delMs(m)}>Delete</Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Projects", href: "/projects/projects" }, { label: p.projectName }]}
        title={p.projectName}
        subtitle={
          <span className="flex items-center gap-3">
            <StatusBadge status={p.status} />
            <span className="font-mono text-xs text-ink-muted">{p.name}</span>
            {p.customer && (
              <span className="text-ink-soft">
                for{" "}
                <a href={`/accounting/customers/${p.customer.id}`} className="text-brand-600 hover:underline">
                  {p.customer.customerName}
                </a>
              </span>
            )}
            {p.projectManager && <span className="text-ink-soft">PM: {p.projectManager.employeeName}</span>}
            <span className="text-xs text-ink-muted">· Billing: {p.billingType}</span>
          </span>
        }
        actions={
          <Button variant="secondary" onClick={() => history.back()} type="button">
            ← Back
          </Button>
        }
      />

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}

      <div className="mb-4">
        <Segmented<TabKey>
          value={tab}
          onChange={setTab}
          options={[
            { value: "overview",   label: "Overview" },
            { value: "tasks",      label: "Tasks",      count: data.project.tasks.length },
            { value: "milestones", label: "Milestones", count: milestones.length },
            { value: "gantt",      label: "Gantt" },
            { value: "budget",     label: "Budget" },
          ]}
        />
      </div>

      {tab === "overview" && (
        <div className="space-y-6 max-w-6xl">
          <div>
            <WorkflowActions doctype="Project" docId={p.id} onChange={load} />
          </div>

          <section className="grid grid-cols-4 gap-4">
            <Card className="p-4">
              <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">Tasks</div>
              <div className="text-2xl font-semibold text-ink tabular-nums mt-0.5">{data.stats.totalTasks}</div>
              <div className="text-xs text-ink-muted">
                {data.stats.openTasks} open · {data.stats.completedTasks} done
              </div>
            </Card>
            <Card className="p-4">
              <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">Planned hours</div>
              <div className="text-2xl font-semibold text-ink tabular-nums mt-0.5">{data.stats.plannedHours.toFixed(2)}</div>
            </Card>
            <Card className="p-4">
              <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">Logged hours</div>
              <div className="text-2xl font-semibold text-ink tabular-nums mt-0.5">{data.stats.loggedHours.toFixed(2)}</div>
              <div className="text-xs text-ink-muted">
                {data.stats.plannedHours > 0
                  ? `${((data.stats.loggedHours / data.stats.plannedHours) * 100).toFixed(0)}% of plan`
                  : ""}
              </div>
            </Card>
            <Card className="p-4">
              <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">Est / Actual cost</div>
              <div className="text-lg font-semibold text-ink tabular-nums mt-0.5">{Number(p.estimatedCost).toFixed(2)}</div>
              <div className="text-xs text-ink-muted font-mono">actual {Number(p.actualCost).toFixed(2)}</div>
            </Card>
          </section>

          <section>
            <div className="flex items-baseline justify-between mb-2">
              <h2 className="text-lg font-semibold text-ink">Recent time entries</h2>
              <span className="text-xs text-ink-muted">latest 30 lines</span>
            </div>
            <div className="hidden md:block">
              <DataTable<RecentLine>
                columns={[
                  { header: "Date", cell: (l) => <span className="text-xs">{dateShort(l.date)}</span> },
                  { header: "Employee", cell: (l) => <span className="text-xs">{l.timesheet.employee.employeeName}</span> },
                  { header: "Task", cell: (l) => <span className="text-xs">{l.task?.subject ?? "—"}</span> },
                  {
                    header: "Hours",
                    align: "right",
                    cell: (l) => <span className="tabular-nums">{Number(l.hours).toFixed(2)}</span>,
                  },
                  {
                    header: "Billing",
                    align: "right",
                    cell: (l) => (
                      <span className="tabular-nums text-xs">
                        {l.isBillable ? Number(l.billingAmount).toFixed(2) : "—"}
                      </span>
                    ),
                  },
                  {
                    header: "Timesheet",
                    cell: (l) => (
                      <span className="text-xs">
                        <a
                          href={`/projects/timesheets/${l.timesheet.id}`}
                          className="font-mono text-brand-600 hover:underline"
                        >
                          {l.timesheet.name}
                        </a>{" "}
                        <StatusBadge status={l.timesheet.status} />
                      </span>
                    ),
                  },
                ]}
                rows={data.recentLines}
                rowKey={(l) => l.id}
                empty={{ title: "No time logged yet" }}
              />
            </div>
            {data.recentLines.length === 0 ? (
              <div className="md:hidden rounded-xl border border-ink/10 bg-canvas px-4 py-6 text-center text-sm text-ink-muted">
                No time logged yet
              </div>
            ) : (
              <ul className="md:hidden divide-y divide-line rounded-xl border border-ink/10 bg-canvas overflow-hidden">
                {data.recentLines.map((l) => (
                  <li key={l.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-ink truncate">
                          {l.timesheet.employee.employeeName}
                        </div>
                        <div className="text-xs text-ink-muted">
                          {dateShort(l.date)}
                          {l.task && ` · ${l.task.subject}`}
                        </div>
                      </div>
                      <div className="text-end">
                        <div className="font-mono text-ink tabular-nums">
                          {Number(l.hours).toFixed(2)}h
                        </div>
                        {l.isBillable && (
                          <div className="text-xs text-ink-muted tabular-nums">
                            {Number(l.billingAmount).toFixed(2)}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="mt-1 text-xs">
                      <a
                        href={`/projects/timesheets/${l.timesheet.id}`}
                        className="font-mono text-brand-600 hover:underline"
                      >
                        {l.timesheet.name}
                      </a>
                      <span className="text-ink-muted ms-2">{l.timesheet.status}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {p.notes && (
            <Card className="p-4 text-sm">
              <div className="text-xs uppercase text-ink-muted mb-1">Notes</div>
              <div className="whitespace-pre-wrap">{p.notes}</div>
            </Card>
          )}

          <section className="grid grid-cols-2 gap-4">
            <AttachmentsPanel doctype="Project" docId={p.id} />
            <CommentsPanel doctype="Project" docId={p.id} currentUserId={currentUserId()} />
          </section>
        </div>
      )}

      {tab === "milestones" && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <Button variant="brand" onClick={openNewMs}>+ New milestone</Button>
          </div>
          <DataTable
            columns={msColumns}
            rows={milestones}
            rowKey={(m) => m.id}
            empty={{ title: "No milestones yet", description: "Break the project into phases to track delivery." }}
          />
        </div>
      )}

      {tab === "tasks" && (
        <div className="space-y-6">
          <div className="flex justify-end">
            <Button variant="brand" onClick={() => openAddTask()}>+ Add task</Button>
          </div>
          {milestones.map((m) => {
            const rows = tasksByMilestone.grouped[m.id] || [];
            return (
              <Card key={m.id} className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className={MILESTONE_BADGE[m.status]}>{m.status}</span>
                    <h3 className="font-semibold text-ink">{m.name}</h3>
                    <span className="text-xs text-ink-muted">· due {dateShort(m.dueDate)}</span>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => openAddTask({ milestoneId: m.id })}>
                    + Add task
                  </Button>
                </div>
                {rows.length === 0 ? (
                  <div className="text-xs text-ink-muted italic">No tasks in this milestone.</div>
                ) : (
                  <div className="space-y-1">
                    {rows.map((t) => (
                      <TaskRow
                        key={t.id}
                        task={t}
                        childTasks={childrenByParent[t.id] || []}
                        onAddSubtask={() => openAddTask({ parentTaskId: t.id, milestoneId: t.milestoneId ?? undefined })}
                      />
                    ))}
                  </div>
                )}
              </Card>
            );
          })}
          <Card className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-ink">Unassigned</h3>
              <Button variant="ghost" size="sm" onClick={() => openAddTask()}>+ Add task</Button>
            </div>
            {tasksByMilestone.unassigned.length === 0 ? (
              <div className="text-xs text-ink-muted italic">All top-level tasks are in a milestone.</div>
            ) : (
              <div className="space-y-1">
                {tasksByMilestone.unassigned.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    childTasks={childrenByParent[t.id] || []}
                    onAddSubtask={() => openAddTask({ parentTaskId: t.id })}
                  />
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {tab === "budget" && (
        <div className="space-y-4 max-w-4xl">
          <div className="flex justify-end">
            <Button variant="secondary" onClick={() => setBudgetDrawer(true)}>Edit budget</Button>
          </div>
          {overThreshold && (
            <Toast kind="error" message={`Over threshold — utilization ${budgetUtil.toFixed(1)}% ≥ ${budgetThreshold}%`} />
          )}
          <div className="grid grid-cols-4 gap-4">
            <Card className="p-4">
              <div className="text-xs uppercase text-ink-muted">Budget</div>
              <div className="text-2xl font-semibold tabular-nums">{budgetAmt.toFixed(2)}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs uppercase text-ink-muted">Spent</div>
              <div className="text-2xl font-semibold tabular-nums">{budgetSpent.toFixed(2)}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs uppercase text-ink-muted">Remaining</div>
              <div className={`text-2xl font-semibold tabular-nums ${budgetRemaining < 0 ? "text-red-600" : ""}`}>
                {budgetRemaining.toFixed(2)}
              </div>
            </Card>
            <Card className="p-4">
              <div className="text-xs uppercase text-ink-muted">Utilization</div>
              <div className={`text-2xl font-semibold tabular-nums ${overThreshold ? "text-red-600" : ""}`}>
                {budgetUtil.toFixed(1)}%
              </div>
              <div className="text-[11px] text-ink-muted">threshold {budgetThreshold}%</div>
            </Card>
          </div>
          <Card className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs uppercase text-ink-muted">Spent / Budget</div>
              <div className="text-xs text-ink-muted tabular-nums">
                {budgetSpent.toFixed(2)} / {budgetAmt.toFixed(2)}
              </div>
            </div>
            <ProgressBar pct={budgetUtil} />
          </Card>
        </div>
      )}

      {tab === "gantt" && (
        <div className="space-y-4 max-w-4xl">
          <Card className="p-6 text-center">
            <div className="text-sm text-ink-soft mb-3">
              View the full timeline with dependencies, milestones and per-task progress.
            </div>
            <a
              href={`/projects/projects/gantt/${p.id}`}
              className="btn-brand inline-flex"
            >
              Open full-screen Gantt →
            </a>
          </Card>
          <MiniGanttPreview tasks={p.tasks} />
        </div>
      )}

      {/* Milestone drawer */}
      <Drawer
        open={msDrawer.open}
        onClose={() => setMsDrawer({ open: false })}
        title={msDrawer.editing ? "Edit milestone" : "New milestone"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setMsDrawer({ open: false })}>Cancel</Button>
            <Button variant="brand" onClick={saveMs}>Save</Button>
          </>
        }
      >
        <div className="space-y-4">
          <FormField label="Name" required>
            <input
              className="input"
              value={msForm.name}
              onChange={(e) => setMsForm({ ...msForm, name: e.target.value })}
              autoFocus
            />
          </FormField>
          <FormField label="Description">
            <textarea
              className="input"
              rows={3}
              value={msForm.description}
              onChange={(e) => setMsForm({ ...msForm, description: e.target.value })}
            />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Due date">
              <input
                type="date"
                className="input"
                value={msForm.dueDate}
                onChange={(e) => setMsForm({ ...msForm, dueDate: e.target.value })}
              />
            </FormField>
            <FormField label="Status">
              <select
                className="input"
                value={msForm.status}
                onChange={(e) => setMsForm({ ...msForm, status: e.target.value as MilestoneStatus })}
              >
                <option value="Upcoming">Upcoming</option>
                <option value="InProgress">In progress</option>
                <option value="Completed">Completed</option>
                <option value="Missed">Missed</option>
              </select>
            </FormField>
          </div>
        </div>
      </Drawer>

      {/* Budget drawer */}
      <Drawer
        open={budgetDrawer}
        onClose={() => setBudgetDrawer(false)}
        title="Edit budget"
        footer={
          <>
            <Button variant="secondary" onClick={() => setBudgetDrawer(false)}>Cancel</Button>
            <Button variant="brand" onClick={saveBudget}>Save</Button>
          </>
        }
      >
        <div className="space-y-4">
          <FormField label="Budget amount">
            <input
              type="number"
              step="any"
              min={0}
              className="input tabular-nums"
              value={budgetForm.budgetAmount}
              onChange={(e) => setBudgetForm({ ...budgetForm, budgetAmount: Number(e.target.value) })}
            />
          </FormField>
          <FormField label="Alert threshold (%)" hint="Show over-threshold banner when spent ≥ this % of budget.">
            <input
              type="number"
              step="1"
              min={0}
              max={200}
              className="input tabular-nums"
              value={budgetForm.budgetThresholdPct}
              onChange={(e) => setBudgetForm({ ...budgetForm, budgetThresholdPct: Number(e.target.value) })}
            />
          </FormField>
        </div>
      </Drawer>

      {/* Task drawer */}
      <Drawer
        open={taskDrawer.open}
        onClose={() => setTaskDrawer({ open: false })}
        title={taskDrawer.parentTaskId ? "Add subtask" : "Add task"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setTaskDrawer({ open: false })}>Cancel</Button>
            <Button variant="brand" onClick={saveTask}>Create</Button>
          </>
        }
      >
        <div className="space-y-4">
          <FormField label="Subject" required>
            <input
              className="input"
              value={taskForm.subject}
              onChange={(e) => setTaskForm({ ...taskForm, subject: e.target.value })}
              autoFocus
            />
          </FormField>
          <FormField label="Description">
            <textarea
              className="input"
              rows={3}
              value={taskForm.description}
              onChange={(e) => setTaskForm({ ...taskForm, description: e.target.value })}
            />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Status">
              <select
                className="input"
                value={taskForm.status}
                onChange={(e) => setTaskForm({ ...taskForm, status: e.target.value as typeof taskForm.status })}
              >
                <option>Open</option>
                <option value="InProgress">In progress</option>
                <option>Completed</option>
                <option>Cancelled</option>
              </select>
            </FormField>
            <FormField label="Priority">
              <select
                className="input"
                value={taskForm.priority}
                onChange={(e) => setTaskForm({ ...taskForm, priority: e.target.value as typeof taskForm.priority })}
              >
                <option>Low</option>
                <option>Medium</option>
                <option>High</option>
                <option>Urgent</option>
              </select>
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Expected hours">
              <input
                type="number"
                step="any"
                min={0}
                className="input tabular-nums"
                value={taskForm.expectedHours}
                onChange={(e) => setTaskForm({ ...taskForm, expectedHours: Number(e.target.value) })}
              />
            </FormField>
            <FormField label="Weight">
              <input
                type="number"
                step="any"
                min={0}
                className="input tabular-nums"
                value={taskForm.weight}
                onChange={(e) => setTaskForm({ ...taskForm, weight: Number(e.target.value) })}
              />
            </FormField>
          </div>
          {!taskDrawer.parentTaskId && (
            <FormField label="Milestone">
              <select
                className="input"
                value={taskForm.milestoneId}
                onChange={(e) => setTaskForm({ ...taskForm, milestoneId: e.target.value })}
              >
                <option value="">— None —</option>
                {milestones.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </FormField>
          )}
        </div>
      </Drawer>

      <div className="rounded-xl border border-ink/10 bg-canvas p-4 mt-6">
        <h3 className="text-sm font-semibold text-ink mb-3">Activity</h3>
        <DocActivityPanel doctype="Project" docId={projectId} />
      </div>
    </>
  );
}

// ── Task row w/ subtasks ──────────────────────────────────────────────

// Note: `childTasks` not `children` — the latter is React's JSX-nesting
// prop and ESLint's react/no-children-prop flags passing it explicitly.
// This component takes a flat list of subtasks, not nested JSX.
function TaskRow({
  task,
  childTasks,
  onAddSubtask,
  level = 0,
}: {
  task: Task;
  childTasks: Task[];
  onAddSubtask: () => void;
  level?: number;
}) {
  const progress = num(task.progressPct);
  const due = task.dueDate ?? task.endDate ?? null;
  const smaller = level > 0 ? "text-xs" : "text-sm";
  return (
    <div>
      <div
        className={`flex items-center gap-3 py-2 border-b border-ink-muted/5 ${smaller}`}
        style={{ paddingLeft: level * 16 }}
      >
        <a
          href={`/projects/tasks?taskId=${task.id}`}
          className="flex-1 font-medium text-ink hover:text-brand-700 truncate"
        >
          {task.subject}
        </a>
        <span className="w-32 text-ink-soft text-xs truncate">
          {task.assignedEmployee?.employeeName ?? "—"}
        </span>
        <span className="w-24 text-ink-muted text-xs tabular-nums">{dateShort(due)}</span>
        <div className="w-24"><StatusBadge status={task.status} /></div>
        <div className="w-32">
          <ProgressBar pct={progress} />
        </div>
        <span className="w-10 text-end tabular-nums text-xs text-ink-muted">{Math.round(progress)}%</span>
        {level === 0 && (
          <Button variant="ghost" size="sm" onClick={onAddSubtask}>+ Sub</Button>
        )}
      </div>
      {childTasks.map((c) => (
        <TaskRow key={c.id} task={c} childTasks={[]} onAddSubtask={onAddSubtask} level={level + 1} />
      ))}
    </div>
  );
}

// ── Mini Gantt preview — next 30 days ─────────────────────────────────

function MiniGanttPreview({ tasks }: { tasks: Task[] }) {
  const now = new Date();
  const startMs = now.getTime();
  const days = 30;
  const endMs = startMs + days * 86400_000;
  const bars = tasks
    .map((t) => {
      const s = t.startDate ? new Date(t.startDate).getTime() : null;
      const e = (t.endDate ?? t.dueDate) ? new Date((t.endDate ?? t.dueDate)!).getTime() : null;
      if (!s || !e) return null;
      if (e < startMs || s > endMs) return null;
      const left = Math.max(0, ((s - startMs) / (endMs - startMs)) * 100);
      const right = Math.min(100, ((e - startMs) / (endMs - startMs)) * 100);
      return { t, left, width: Math.max(1, right - left) };
    })
    .filter(Boolean) as { t: Task; left: number; width: number }[];

  return (
    <Card className="p-4">
      <div className="text-xs uppercase text-ink-muted mb-3">Next 30 days</div>
      {bars.length === 0 ? (
        <div className="text-xs text-ink-muted italic">No tasks scheduled in this window.</div>
      ) : (
        <div className="space-y-1.5">
          {bars.slice(0, 8).map(({ t, left, width }) => (
            <div key={t.id} className="flex items-center gap-3 text-xs">
              <div className="w-40 truncate text-ink-soft">{t.subject}</div>
              <div className="flex-1 relative h-4 bg-surface-sunken rounded">
                <div
                  className="absolute top-0 bottom-0 rounded bg-brand-gradient opacity-80"
                  style={{ left: `${left}%`, width: `${width}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
