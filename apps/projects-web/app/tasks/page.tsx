"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "../../lib/api";
import {
  Button,
  DataTable,
  Drawer,
  FilterBar,
  FormField,
  PageHeader,
  Segmented,
  StatusBadge,
  Toast,
  dateShort,
  type Column,
} from "../../components/ui";
import {
  SavedViewsMenu,
  Tour,
  useListPageCommands,
  useOptionalUIBackends,
  useRealtimeList,
  useSavedViews,
  type TourStep,
} from "@lumaara/web-ui";
import { Icon } from "../../components/app-shell";
import { KanbanBoard, type KanbanColumn } from "../../components/kanban";
import { CalendarView } from "../../components/calendar";

interface Employee { id: string; employeeCode: string; employeeName: string }
interface Project { id: string; name: string; projectName: string }
interface Task {
  id: string;
  subject: string;
  status: string;
  priority: string;
  expectedHours: string;
  actualHours: string;
  startDate: string | null;
  endDate: string | null;
  project: { id: string; name: string; projectName: string };
  assignedEmployee: Employee | null;
}

const emptyForm = {
  projectId: "",
  subject: "",
  description: "",
  status: "Open" as const,
  priority: "Medium" as "Low" | "Medium" | "High" | "Urgent",
  assignedEmployeeId: "",
  startDate: "",
  endDate: "",
  expectedHours: 0,
};

type StatusFilter = "all" | "Open" | "InProgress" | "Completed" | "Cancelled";
type ViewMode = "kanban" | "list" | "calendar";

// Four kanban columns. Colors mirror the StatusBadge palette so a task in
// "Completed" looks green on both the list and board.
const KANBAN_COLUMNS: KanbanColumn[] = [
  { status: "Open",       label: "Open",        accent: "bg-blue-500" },
  { status: "InProgress", label: "In progress", accent: "bg-amber-500" },
  { status: "Completed",  label: "Completed",   accent: "bg-green-500" },
  { status: "Cancelled",  label: "Cancelled",   accent: "bg-red-500" },
];

const PRIORITY_CLASS: Record<string, string> = {
  Urgent: "badge-red",
  High:   "badge-amber",
  Medium: "badge-gray",
  Low:    "badge-gray",
};

function PriorityBadge({ priority }: { priority: string }) {
  return <span className={PRIORITY_CLASS[priority] ?? "badge-gray"}>{priority}</span>;
}

function InnerTasksPage() {
  const searchParams = useSearchParams();
  const filterProjectId = searchParams.get("projectId") ?? "";

  const [rows, setRows] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [projectFilter, setProjectFilter] = useState(filterProjectId);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...emptyForm, projectId: filterProjectId });
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("kanban");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ts, ps, es] = await Promise.all([
        api.get<Task[]>(
          projectFilter ? `/tasks?projectId=${projectFilter}` : "/tasks",
        ),
        api.get<Project[]>("/projects"),
        api.get<Employee[]>("/employees"),
      ]);
      setRows(ts);
      setProjects(ps);
      setEmployees(es);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }, [projectFilter]);
  useEffect(() => {
    load();
  }, [load]);

  useListPageCommands({
    singular: "Task",
    plural: "Tasks",
    refresh: load,
  });

  useRealtimeList("task", load);

  const backends = useOptionalUIBackends();
  const views = useSavedViews<{
    search: string;
    statusFilter: StatusFilter;
    projectFilter: string;
  }>("projects-web:tasks", backends?.views);

  const tourSteps: TourStep[] = [
    { target: "[data-tour=projects-tasks-v1-header]", title: "Tasks", body: "This is where you manage tasks. Filter by status, search by name, and drill into any row for details.", placement: "bottom" },
    { target: "[data-tour=projects-tasks-v1-new]", title: "Create a new task", body: "Click here to add your first task. The form captures all the required fields and lets you save as draft or submit immediately.", placement: "bottom" },
    { target: "[data-tour=projects-tasks-v1-filter]", title: "Save a filtered view", body: "Narrow down with the filters, then use the Views menu to save and name the filter set so it's one click next time.", placement: "bottom" },
  ];

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/tasks", {
        ...form,
        description: form.description || null,
        assignedEmployeeId: form.assignedEmployeeId || null,
        startDate: form.startDate ? new Date(form.startDate).toISOString() : null,
        endDate: form.endDate ? new Date(form.endDate).toISOString() : null,
      });
      setForm({ ...emptyForm, projectId: form.projectId });
      setShowForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  async function updateStatus(t: Task, status: Task["status"], e: React.MouseEvent) {
    e.stopPropagation();
    setError(null);
    try {
      await api.put(`/tasks/${t.id}`, { projectId: t.project.id, subject: t.subject, status });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  // Drag-and-drop between kanban columns. Optimistic — snap the card to the
  // new column immediately, then PUT the status change. Rollback on failure.
  // Task PUT requires projectId + subject as a full body; passing just status
  // would fail the required-field zod check on the server.
  async function moveCard(row: Task, newStatus: string) {
    if (row.status === newStatus) return;
    const prev = rows;
    setRows((rs) =>
      rs.map((r) => (r.id === row.id ? { ...r, status: newStatus } : r)),
    );
    try {
      await api.put(`/tasks/${row.id}`, {
        projectId: row.project.id,
        subject: row.subject,
        status: newStatus,
      });
    } catch (e) {
      setRows(prev);
      setError(e instanceof Error ? e.message : "Move failed");
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((t) => {
      if (statusFilter !== "all" && t.status !== statusFilter) return false;
      if (
        q &&
        !`${t.subject} ${t.project.projectName} ${t.assignedEmployee?.employeeName ?? ""}`
          .toLowerCase()
          .includes(q)
      )
        return false;
      return true;
    });
  }, [rows, search, statusFilter]);

  const counts = useMemo(() => ({
    all:        rows.length,
    Open:       rows.filter((t) => t.status === "Open").length,
    InProgress: rows.filter((t) => t.status === "InProgress").length,
    Completed:  rows.filter((t) => t.status === "Completed").length,
    Cancelled:  rows.filter((t) => t.status === "Cancelled").length,
  }), [rows]);

  const columns: Column<Task>[] = [
    {
      header: "Task",
      cell: (t) => (
        <div onClick={(e) => e.stopPropagation()}>
          <a
            href={`/projects/tasks/${t.id}`}
            className="font-medium text-ink hover:text-brand-700"
          >
            {t.subject}
          </a>
          <div className="text-xs text-ink-muted">{t.project.projectName}</div>
        </div>
      ),
    },
    {
      header: "Assignee",
      cell: (t) => (
        <span className="text-ink-soft">{t.assignedEmployee?.employeeName ?? "—"}</span>
      ),
    },
    {
      header: "Priority",
      cell: (t) => <PriorityBadge priority={t.priority} />,
    },
    {
      header: "Dates",
      cell: (t) => (
        <span className="text-xs text-ink-soft tabular-nums">
          {dateShort(t.startDate)} → {dateShort(t.endDate)}
        </span>
      ),
    },
    {
      header: "Hours",
      align: "right",
      cell: (t) => (
        <span className="tabular-nums text-ink-soft font-mono text-xs">
          {Number(t.actualHours).toFixed(1)} / {Number(t.expectedHours).toFixed(1)}
        </span>
      ),
    },
    {
      header: "Status",
      cell: (t) => <StatusBadge status={t.status} />,
    },
    {
      header: "",
      align: "right",
      cell: (t) => (
        <span onClick={(e) => e.stopPropagation()} className="inline-flex gap-1">
          {t.status !== "InProgress" && t.status !== "Completed" && t.status !== "Cancelled" && (
            <button
              onClick={(e) => updateStatus(t, "InProgress", e)}
              className="btn-ghost btn-sm"
            >
              Start
            </button>
          )}
          {t.status !== "Completed" && t.status !== "Cancelled" && (
            <button
              onClick={(e) => updateStatus(t, "Completed", e)}
              className="btn-ghost btn-sm"
            >
              Done
            </button>
          )}
        </span>
      ),
    },
  ];

  return (
    <>
      <Tour id="projects-web.tasks.v1" steps={tourSteps} />
      <div data-tour="projects-tasks-v1-header">
      <PageHeader
        breadcrumb={[{ label: "Home", href: "/" }, { label: "Tasks" }]}
        title="Tasks"
        subtitle={`${rows.length} task${rows.length === 1 ? "" : "s"}`}
        actions={
          <Button variant="brand" onClick={() => setShowForm(true)}>
            + New task
          </Button>
        }
      />
      </div>

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}

      <div className="space-y-4">
        <div data-tour="projects-tasks-v1-filter">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search task, project, or assignee…" }}
          filters={
            <>
              {view === "list" && (
                <Segmented
                  value={statusFilter}
                  onChange={setStatusFilter}
                  options={[
                    { value: "all",        label: "All",         count: counts.all },
                    { value: "Open",       label: "Open",        count: counts.Open },
                    { value: "InProgress", label: "In progress", count: counts.InProgress },
                    { value: "Completed",  label: "Completed",   count: counts.Completed },
                    { value: "Cancelled",  label: "Cancelled",   count: counts.Cancelled },
                  ]}
                />
              )}
              <select
                className="input py-1 text-xs"
                value={projectFilter}
                onChange={(e) => setProjectFilter(e.target.value)}
              >
                <option value="">All projects</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.projectName} ({p.name})
                  </option>
                ))}
              </select>
            </>
          }
          actions={
            <>
              <SavedViewsMenu
                controller={views}
                currentFilters={{ search, statusFilter, projectFilter }}
                onApply={(f) => {
                  setSearch(f.search);
                  setStatusFilter(f.statusFilter);
                  setProjectFilter(f.projectFilter);
                }}
              />
              <Segmented<ViewMode>
                value={view}
                onChange={setView}
                options={[
                  { value: "kanban", label: "Kanban" },
                  { value: "calendar", label: "Calendar" },
                  { value: "list", label: "List" },
                ]}
              />
            </>
          }
        />
        </div>
        {view === "calendar" ? (
          <CalendarView<Task>
            rows={filtered}
            // Task ranges: startDate → endDate. If endDate is missing the
            // helper collapses to a point event on startDate.
            getStart={(t) => t.startDate}
            getEnd={(t) => t.endDate}
            rowKey={(t) => t.id}
            chipAccent={(t) =>
              t.status === "Completed"
                ? "bg-green-500"
                : t.status === "InProgress"
                  ? "bg-amber-500"
                  : t.status === "Cancelled"
                    ? "bg-red-500"
                    : "bg-blue-500"
            }
            renderChip={(t) => t.subject}
            onRowClick={(t) =>
              (window.location.href = `/projects/tasks/${t.id}`)
            }
            emptyMessage="No tasks scheduled this month."
          />
        ) : view === "kanban" ? (
          <KanbanBoard<Task>
            columns={KANBAN_COLUMNS}
            rows={filtered}
            getStatus={(t) => t.status}
            rowKey={(t) => t.id}
            onMoveCard={moveCard}
            loading={loading}
            emptyMessage={
              search || projectFilter
                ? "No tasks match your filters."
                : "No tasks yet — break your project down into trackable work items."
            }
            renderCard={(t) => (
              <div className="space-y-1.5">
                <div className="flex items-start justify-between gap-2">
                  <a
                    href={`/projects/tasks/${t.id}`}
                    className="font-medium text-ink hover:text-brand-700 truncate"
                    onClick={(e) => e.stopPropagation()}
                    draggable={false}
                  >
                    {t.subject}
                  </a>
                  <PriorityBadge priority={t.priority} />
                </div>
                <div className="text-[11px] text-ink-muted truncate">
                  {t.project.projectName}
                </div>
                {t.assignedEmployee && (
                  <div className="text-[11px] text-ink-soft truncate">
                    {t.assignedEmployee.employeeName}
                  </div>
                )}
                {(t.startDate || t.endDate) && (
                  <div className="text-[11px] text-ink-muted tabular-nums">
                    {dateShort(t.startDate)} → {dateShort(t.endDate)}
                  </div>
                )}
                {(Number(t.actualHours) > 0 || Number(t.expectedHours) > 0) && (
                  <div className="text-[11px] text-ink-soft font-mono tabular-nums">
                    {Number(t.actualHours).toFixed(1)}h / {Number(t.expectedHours).toFixed(1)}h
                  </div>
                )}
              </div>
            )}
          />
        ) : (
          <DataTable
            columns={columns}
            rows={filtered}
            rowKey={(t) => t.id}
            onRowClick={(t) => (window.location.href = `/projects/tasks/${t.id}`)}
            loading={loading}
            empty={{
              icon: Icon.clipboard,
              title: search || statusFilter !== "all" || projectFilter ? "No matching tasks" : "No tasks yet",
              description: search || statusFilter !== "all" || projectFilter
                ? "Try changing your search or filter."
                : "Break your project down into trackable work items.",
              action: !search && statusFilter === "all" && !projectFilter && (
                <Button variant="brand" onClick={() => setShowForm(true)}>+ New task</Button>
              ),
            }}
          />
        )}
      </div>

      <Drawer
        open={showForm}
        onClose={() => setShowForm(false)}
        title="New task"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button variant="brand" onClick={(e) => create(e as unknown as React.FormEvent)}>
              Create task
            </Button>
          </>
        }
      >
        <form onSubmit={create} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Project" required>
              <select
                required
                className="input"
                value={form.projectId}
                onChange={(e) => setForm({ ...form, projectId: e.target.value })}
              >
                <option value="">Select project…</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.projectName}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Assignee">
              <select
                className="input"
                value={form.assignedEmployeeId}
                onChange={(e) => setForm({ ...form, assignedEmployeeId: e.target.value })}
              >
                <option value="">— None —</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>{emp.employeeName}</option>
                ))}
              </select>
            </FormField>
          </div>
          <FormField label="Subject" required>
            <input
              required
              className="input"
              placeholder="Design landing page"
              value={form.subject}
              onChange={(e) => setForm({ ...form, subject: e.target.value })}
              autoFocus
            />
          </FormField>
          <FormField label="Description">
            <textarea
              className="input"
              rows={3}
              placeholder="Optional"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </FormField>
          <div className="grid grid-cols-4 gap-3">
            <FormField label="Priority">
              <select
                className="input"
                value={form.priority}
                onChange={(e) =>
                  setForm({ ...form, priority: e.target.value as typeof form.priority })
                }
              >
                <option>Low</option>
                <option>Medium</option>
                <option>High</option>
                <option>Urgent</option>
              </select>
            </FormField>
            <FormField label="Start">
              <input
                type="date"
                className="input"
                value={form.startDate}
                onChange={(e) => setForm({ ...form, startDate: e.target.value })}
              />
            </FormField>
            <FormField label="End">
              <input
                type="date"
                className="input"
                value={form.endDate}
                onChange={(e) => setForm({ ...form, endDate: e.target.value })}
              />
            </FormField>
            <FormField label="Expected hrs">
              <input
                type="number"
                step="0.5"
                min={0}
                className="input tabular-nums"
                value={form.expectedHours}
                onChange={(e) => setForm({ ...form, expectedHours: Number(e.target.value) })}
              />
            </FormField>
          </div>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </>
  );
}

export default function TasksPage() {
  return (
    <Suspense fallback={null}>
      <InnerTasksPage />
    </Suspense>
  );
}
