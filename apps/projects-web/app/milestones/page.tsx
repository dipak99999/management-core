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

interface Milestone {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  dueDate: string | null;
  status: "Upcoming" | "InProgress" | "Completed" | "Missed";
  order: number;
  createdAt: string;
  _count?: { tasks: number };
}

const emptyForm = {
  projectId: "",
  name: "",
  description: "",
  dueDate: "",
  status: "Upcoming" as Milestone["status"],
  order: 0,
};

function InnerMilestonesPage() {
  const searchParams = useSearchParams();
  const filterProjectId = searchParams.get("projectId") ?? "";

  const [rows, setRows] = useState<Milestone[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [projectFilter, setProjectFilter] = useState(filterProjectId);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const qs = projectFilter ? `?projectId=${encodeURIComponent(projectFilter)}` : "";
      const [m, p] = await Promise.all([
        api.get<Milestone[]>(`/milestones${qs}`),
        projects.length === 0 ? api.get<Project[]>("/projects") : Promise.resolve(projects),
      ]);
      setRows(m);
      if (projects.length === 0) setProjects(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load milestones");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectFilter]);

  useListPageCommands({
    singular: "Milestone",
    plural: "Milestones",
    refresh: load,
  });
  function openNew() {
    setForm({ ...emptyForm, projectId: projectFilter || projects[0]?.id || "" });
    setEditingId(null);
    setShowForm(true);
  }

  function openEdit(m: Milestone) {
    setForm({
      projectId: m.projectId,
      name: m.name,
      description: m.description ?? "",
      dueDate: m.dueDate ? m.dueDate.slice(0, 10) : "",
      status: m.status,
      order: m.order,
    });
    setEditingId(m.id);
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
        name: form.name,
        description: form.description || null,
        dueDate: form.dueDate || null,
        status: form.status,
        order: Number(form.order) || 0,
      };
      if (editingId) {
        await api.put(`/milestones/${editingId}`, payload);
        setMsg("Milestone updated");
      } else {
        await api.post("/milestones", payload);
        setMsg("Milestone created");
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
    if (!confirm("Delete this milestone? Tasks linked to it will stay but lose the link.")) return;
    setDeletingId(id);
    try {
      await api.del(`/milestones/${id}`);
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
    return rows.filter((m) =>
      [m.name, m.description, projects.find((p) => p.id === m.projectId)?.projectName]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [rows, search, projects]);

  const columns: Column<Milestone>[] = [
    {
      header: "Milestone",
      cell: (m) => <span className="font-medium">{m.name}</span>,
    },
    {
      header: "Project",
      cell: (m) => (
        <span className="text-ink-soft">
          {projects.find((p) => p.id === m.projectId)?.projectName ?? m.projectId}
        </span>
      ),
    },
    {
      header: "Status",
      cell: (m) => <StatusBadge status={m.status} />,
    },
    {
      header: "Due",
      cell: (m) => (
        <span className="text-ink-soft">{m.dueDate ? dateShort(m.dueDate) : "—"}</span>
      ),
    },
    {
      header: "Tasks",
      cell: (m) => (
        <span className="text-ink-soft">{m._count?.tasks ?? 0}</span>
      ),
    },
    {
      header: "",
      cell: (m) => (
        <div className="flex items-center gap-2 justify-end">
          <button
            className="text-xs text-brand-700 hover:underline"
            onClick={(e) => {
              e.stopPropagation();
              openEdit(m);
            }}
          >
            Edit
          </button>
          <button
            className="text-xs text-red-600 hover:underline disabled:opacity-50"
            disabled={deletingId === m.id}
            onClick={(e) => {
              e.stopPropagation();
              void del(m.id);
            }}
          >
            {deletingId === m.id ? "Deleting…" : "Delete"}
          </button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        icon={Icon.layers}
        title="Milestones"
        subtitle="Group tasks under dated checkpoints. Each milestone can own many tasks and shows up as a diamond on the project Gantt."
        actions={
          <Button variant="brand" onClick={openNew}>
            + New milestone
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
            placeholder: "Search milestones…",
          }}
          filters={
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
          }
          actions={<SavedViewsControls listKey="projects-web:milestones" current={{ search, projectFilter }} onApply={(fv) => { setSearch(fv.search); setProjectFilter(fv.projectFilter); }} />}
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(m) => m.id}
          loading={loading}
          empty={{
            icon: Icon.layers,
            title: search || projectFilter ? "No matches" : "No milestones yet",
            description:
              search || projectFilter
                ? "Try changing the project filter or search term."
                : "Milestones group tasks under a dated checkpoint — create your first one.",
            action: !search && !projectFilter && (
              <Button variant="brand" onClick={openNew}>
                + Create milestone
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
        title={editingId ? "Edit milestone" : "New milestone"}
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
              {editingId ? "Save changes" : "Create milestone"}
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
          <FormField label="Name" required>
            <input
              className="input"
              placeholder="MVP launch"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              autoFocus
            />
          </FormField>
          <FormField label="Description">
            <textarea
              className="input min-h-[80px]"
              placeholder="Scope + exit criteria for this milestone"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </FormField>
          <FormField label="Due date">
            <input
              className="input"
              type="date"
              value={form.dueDate}
              onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
            />
          </FormField>
          <FormField label="Status">
            <select
              className="input"
              value={form.status}
              onChange={(e) =>
                setForm({ ...form, status: e.target.value as Milestone["status"] })
              }
            >
              <option value="Upcoming">Upcoming</option>
              <option value="InProgress">In progress</option>
              <option value="Completed">Completed</option>
              <option value="Missed">Missed</option>
            </select>
          </FormField>
          <FormField label="Sort order">
            <input
              className="input"
              type="number"
              min={0}
              value={form.order}
              onChange={(e) => setForm({ ...form, order: Number(e.target.value) || 0 })}
            />
          </FormField>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </>
  );
}

export default function MilestonesPage() {
  return (
    <Suspense fallback={null}>
      <InnerMilestonesPage />
    </Suspense>
  );
}
