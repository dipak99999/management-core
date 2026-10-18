"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useListPageCommands, SavedViewsControls } from "@lumaara/web-ui";
import { useSearchParams } from "next/navigation";
import { api } from "../../lib/api";
import {
  Button,
  DataTable,
  Drawer,
  FilterBar,
  FormField,
  PageHeader,
  StatusBadge,
  Toast,
  dateShort,
  type Column,
} from "../../components/ui";
import { Icon } from "../../components/app-shell";

interface Project {
  id: string;
  name: string;
  projectName: string;
}
interface Employee {
  id: string;
  employeeCode: string;
  employeeName: string;
}

type Priority = "Low" | "Medium" | "High" | "Critical";
type Severity = "Minor" | "Major" | "Blocker";
type IssueType = "Bug" | "Enhancement" | "Task" | "Question";
type IssueStatus =
  | "Open"
  | "InProgress"
  | "InReview"
  | "Resolved"
  | "Closed"
  | "WontFix";

interface Issue {
  id: string;
  name: string;
  projectId: string;
  title: string;
  description: string | null;
  priority: Priority;
  severity: Severity;
  issueType: IssueType;
  status: IssueStatus;
  assignedEmployeeId: string | null;
  dueDate: string | null;
  createdAt: string;
  project?: { projectName: string | null; name: string };
  assignedEmployee?: { employeeName: string; employeeCode: string } | null;
}

const emptyForm = {
  projectId: "",
  title: "",
  description: "",
  priority: "Medium" as Priority,
  severity: "Minor" as Severity,
  issueType: "Bug" as IssueType,
  status: "Open" as IssueStatus,
  assignedEmployeeId: "",
  dueDate: "",
};

const PRIORITY_CLASS: Record<Priority, string> = {
  Critical: "badge-red",
  High: "badge-amber",
  Medium: "badge-gray",
  Low: "badge-gray",
};
function PriorityBadge({ priority }: { priority: Priority }) {
  return <span className={PRIORITY_CLASS[priority]}>{priority}</span>;
}

function InnerIssuesPage() {
  const searchParams = useSearchParams();
  const filterProjectId = searchParams.get("projectId") ?? "";

  const [rows, setRows] = useState<Issue[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [projectFilter, setProjectFilter] = useState(filterProjectId);
  const [statusFilter, setStatusFilter] = useState<"all" | IssueStatus>("all");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (projectFilter) params.set("projectId", projectFilter);
      if (statusFilter !== "all") params.set("status", statusFilter);
      const qs = params.toString() ? `?${params.toString()}` : "";
      const [i, p, e] = await Promise.all([
        api.get<Issue[]>(`/issues${qs}`),
        projects.length === 0 ? api.get<Project[]>("/projects") : Promise.resolve(projects),
        employees.length === 0
          ? api
              .get<Employee[]>("/employees")
              .catch(() => [] as Employee[])
          : Promise.resolve(employees),
      ]);
      setRows(i);
      if (projects.length === 0) setProjects(p);
      if (employees.length === 0) setEmployees(e);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load issues");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectFilter, statusFilter]);

  useListPageCommands({
    singular: "Issue",
    plural: "Issues",
    refresh: load,
  });
  function openNew() {
    setForm({ ...emptyForm, projectId: projectFilter || projects[0]?.id || "" });
    setEditingId(null);
    setShowForm(true);
  }
  function openEdit(i: Issue) {
    setForm({
      projectId: i.projectId,
      title: i.title,
      description: i.description ?? "",
      priority: i.priority,
      severity: i.severity,
      issueType: i.issueType,
      status: i.status,
      assignedEmployeeId: i.assignedEmployeeId ?? "",
      dueDate: i.dueDate ? i.dueDate.slice(0, 10) : "",
    });
    setEditingId(i.id);
    setShowForm(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.projectId) {
      setError("Pick a project");
      return;
    }
    try {
      const payload = {
        projectId: form.projectId,
        title: form.title,
        description: form.description || null,
        priority: form.priority,
        severity: form.severity,
        issueType: form.issueType,
        status: form.status,
        assignedEmployeeId: form.assignedEmployeeId || null,
        dueDate: form.dueDate || null,
      };
      if (editingId) {
        await api.put(`/issues/${editingId}`, payload);
        setMsg("Issue updated");
      } else {
        await api.post("/issues", payload);
        setMsg("Issue created");
      }
      setShowForm(false);
      setEditingId(null);
      setForm(emptyForm);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    }
  }

  async function del(id: string) {
    if (deletingId) return;
    if (!confirm("Delete this issue? This cannot be undone.")) return;
    setDeletingId(id);
    try {
      await api.del(`/issues/${id}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeletingId(null);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((i) =>
      [i.name, i.title, i.description, i.project?.projectName]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [rows, search]);

  const columns: Column<Issue>[] = [
    { header: "ID", cell: (i) => <span className="font-mono text-xs">{i.name}</span> },
    {
      header: "Title",
      cell: (i) => <span className="font-medium">{i.title}</span>,
    },
    {
      header: "Project",
      cell: (i) => (
        <span className="text-ink-soft">
          {i.project?.projectName ?? i.project?.name ?? "—"}
        </span>
      ),
    },
    { header: "Type", cell: (i) => <span className="badge-gray">{i.issueType}</span> },
    { header: "Status", cell: (i) => <StatusBadge status={i.status} /> },
    { header: "Priority", cell: (i) => <PriorityBadge priority={i.priority} /> },
    {
      header: "Assignee",
      cell: (i) => (
        <span className="text-ink-soft text-xs">
          {i.assignedEmployee?.employeeName ?? "—"}
        </span>
      ),
    },
    {
      header: "Due",
      cell: (i) => (
        <span className="text-ink-soft">
          {i.dueDate ? dateShort(i.dueDate) : "—"}
        </span>
      ),
    },
    {
      header: "",
      cell: (i) => (
        <div className="flex items-center gap-2 justify-end">
          <button
            className="text-xs text-brand-700 hover:underline"
            onClick={(e) => {
              e.stopPropagation();
              openEdit(i);
            }}
          >
            Edit
          </button>
          <button
            className="text-xs text-red-600 hover:underline disabled:opacity-50"
            disabled={deletingId === i.id}
            onClick={(e) => {
              e.stopPropagation();
              void del(i.id);
            }}
          >
            {deletingId === i.id ? "Deleting…" : "Delete"}
          </button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        icon={Icon.clipboard}
        title="Issues"
        subtitle="Bug / enhancement / task tracker scoped to a project. Separate from customer-support tickets."
        actions={
          <Button variant="brand" onClick={openNew}>
            + New issue
          </Button>
        }
      />

      {error && (
        <div className="mb-4">
          <Toast kind="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}
      {msg && (
        <div className="mb-4">
          <Toast kind="success" message={msg} onDismiss={() => setMsg(null)} />
        </div>
      )}

      <div className="space-y-4">
        <FilterBar
          search={{
            value: search,
            onChange: setSearch,
            placeholder: "Search by ID or title…",
          }}
          filters={
            <>
              <select
                className="input w-56"
                value={projectFilter}
                onChange={(e) => setProjectFilter(e.target.value)}
              >
                <option value="">All projects</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.projectName ?? p.name}
                  </option>
                ))}
              </select>
              <select
                className="input w-40"
                value={statusFilter}
                onChange={(e) =>
                  setStatusFilter(e.target.value as "all" | IssueStatus)
                }
              >
                <option value="all">All status</option>
                <option value="Open">Open</option>
                <option value="InProgress">In progress</option>
                <option value="InReview">In review</option>
                <option value="Resolved">Resolved</option>
                <option value="Closed">Closed</option>
                <option value="WontFix">Won&apos;t fix</option>
              </select>
            </>
          }
          actions={<SavedViewsControls listKey="projects-web:issues" current={{ search, statusFilter }} onApply={(fv) => { setSearch(fv.search); setStatusFilter(fv.statusFilter); }} />}
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(i) => i.id}
          loading={loading}
          empty={{
            icon: Icon.clipboard,
            title: search || projectFilter || statusFilter !== "all" ? "No matches" : "No issues yet",
            description:
              search || projectFilter || statusFilter !== "all"
                ? "Try changing the filters."
                : "Track engineering work with lightweight issues — create your first.",
            action: !search && !projectFilter && statusFilter === "all" && (
              <Button variant="brand" onClick={openNew}>
                + Create issue
              </Button>
            ),
          }}
        />
      </div>

      <Drawer
        open={showForm}
        onClose={() => {
          setShowForm(false);
          setEditingId(null);
          setForm(emptyForm);
        }}
        title={editingId ? "Edit issue" : "New issue"}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setShowForm(false);
                setEditingId(null);
                setForm(emptyForm);
              }}
            >
              Cancel
            </Button>
            <Button variant="brand" onClick={(e) => save(e as unknown as React.FormEvent)}>
              {editingId ? "Save changes" : "Create issue"}
            </Button>
          </>
        }
      >
        <form onSubmit={save} className="space-y-4">
          <FormField label="Project" required>
            <select
              className="input"
              value={form.projectId}
              onChange={(e) => setForm({ ...form, projectId: e.target.value })}
              required
            >
              <option value="">— Pick a project —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.projectName ?? p.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Title" required>
            <input
              className="input"
              placeholder="Short summary"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              required
              autoFocus
              maxLength={300}
            />
          </FormField>
          <FormField label="Description">
            <textarea
              className="input min-h-[100px]"
              placeholder="Expected / actual / repro steps"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </FormField>
          <div className="grid grid-cols-3 gap-3">
            <FormField label="Type">
              <select
                className="input"
                value={form.issueType}
                onChange={(e) =>
                  setForm({ ...form, issueType: e.target.value as IssueType })
                }
              >
                <option value="Bug">Bug</option>
                <option value="Enhancement">Enhancement</option>
                <option value="Task">Task</option>
                <option value="Question">Question</option>
              </select>
            </FormField>
            <FormField label="Priority">
              <select
                className="input"
                value={form.priority}
                onChange={(e) =>
                  setForm({ ...form, priority: e.target.value as Priority })
                }
              >
                <option value="Low">Low</option>
                <option value="Medium">Medium</option>
                <option value="High">High</option>
                <option value="Critical">Critical</option>
              </select>
            </FormField>
            <FormField label="Severity">
              <select
                className="input"
                value={form.severity}
                onChange={(e) =>
                  setForm({ ...form, severity: e.target.value as Severity })
                }
              >
                <option value="Minor">Minor</option>
                <option value="Major">Major</option>
                <option value="Blocker">Blocker</option>
              </select>
            </FormField>
          </div>
          <FormField label="Status">
            <select
              className="input"
              value={form.status}
              onChange={(e) =>
                setForm({ ...form, status: e.target.value as IssueStatus })
              }
            >
              <option value="Open">Open</option>
              <option value="InProgress">In progress</option>
              <option value="InReview">In review</option>
              <option value="Resolved">Resolved</option>
              <option value="Closed">Closed</option>
              <option value="WontFix">Won&apos;t fix</option>
            </select>
          </FormField>
          <FormField label="Assignee">
            <select
              className="input"
              value={form.assignedEmployeeId}
              onChange={(e) =>
                setForm({ ...form, assignedEmployeeId: e.target.value })
              }
            >
              <option value="">— Unassigned —</option>
              {employees.map((em) => (
                <option key={em.id} value={em.id}>
                  {em.employeeName} ({em.employeeCode})
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Due date">
            <input
              className="input"
              type="date"
              value={form.dueDate}
              onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
            />
          </FormField>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </>
  );
}

export default function IssuesPage() {
  return (
    <Suspense fallback={null}>
      <InnerIssuesPage />
    </Suspense>
  );
}
