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
  Toast,
  type Column,
} from "../../components/ui";
import { Icon } from "../../components/app-shell";

// Sprints workspaces list — Zoho-Sprints-style. A workspace is the top-level
// container for a team's agile work (its own key prefix like "LUM", plus its
// sprints/epics/OKRs/work items). Operators create one per team/product and
// jump into it to drive backlog + board + reports.

interface WorkspaceCounts {
  sprints: number;
  epics: number;
  workItems: number;
  releases: number;
  okrs: number;
}
interface Workspace {
  id: string;
  name: string;
  key: string;
  description: string | null;
  isActive: boolean;
  _count: WorkspaceCounts;
}

interface WorkspaceForm {
  name: string;
  key: string;
  description: string;
  isActive: boolean;
}
const emptyForm: WorkspaceForm = {
  name: "",
  key: "",
  description: "",
  isActive: true,
};

// Convert a zod-flattened `fieldErrors` object into a single friendly line
// while still preserving the field-level mapping for inline hints.
function friendlyErr(e: unknown): { msg: string; fields: Record<string, string> } {
  const fields: Record<string, string> = {};
  let msg = e instanceof Error ? e.message : "Request failed";
  if (e && typeof e === "object") {
    const anyErr = e as { fieldErrors?: Record<string, string[]>; message?: string };
    if (anyErr.fieldErrors) {
      for (const [k, v] of Object.entries(anyErr.fieldErrors)) {
        if (Array.isArray(v) && v.length) fields[k] = v[0]!;
      }
      const first = Object.entries(fields)[0];
      if (first) msg = `${first[0]}: ${first[1]}`;
    }
  }
  return { msg, fields };
}

export default function SprintsWorkspacesPage() {
  const [rows, setRows] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [form, setForm] = useState<WorkspaceForm>(emptyForm);
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true);
    try {
      setRows(await api.get<Workspace[]>("/agile/workspaces"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  useListPageCommands({
    singular: "Sprint",
    plural: "Sprints",
    refresh: load,
  });
  function openNew() {
    setEditingId(null);
    setForm(emptyForm);
    setFieldErrors({});
    setShowEditor(true);
  }
  function openEdit(w: Workspace) {
    setEditingId(w.id);
    setForm({
      name: w.name,
      key: w.key,
      description: w.description ?? "",
      isActive: w.isActive,
    });
    setFieldErrors({});
    setShowEditor(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFieldErrors({});
    try {
      if (editingId) {
        await api.put(`/agile/workspaces/${editingId}`, {
          name: form.name.trim(),
          description: form.description.trim() || null,
          isActive: form.isActive,
        });
        setMsg("Workspace updated");
      } else {
        await api.post("/agile/workspaces", {
          name: form.name.trim(),
          key: form.key.trim().toUpperCase(),
          description: form.description.trim() || null,
          isActive: form.isActive,
        });
        setMsg("Workspace created");
      }
      setShowEditor(false);
      await load();
    } catch (e) {
      const f = friendlyErr(e);
      setFieldErrors(f.fields);
      setError(f.msg);
    } finally {
      setBusy(false);
    }
  }

  async function remove(w: Workspace) {
    if (!confirm(`Delete workspace "${w.name}"? This cannot be undone.`)) return;
    try {
      await api.del(`/agile/workspaces/${w.id}`);
      setMsg("Deleted");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q
      ? rows.filter((r) =>
          [r.name, r.key, r.description].filter(Boolean).some((v) =>
            String(v).toLowerCase().includes(q),
          ),
        )
      : rows;
  }, [rows, search]);

  const columns: Column<Workspace>[] = [
    {
      header: "Key",
      width: "110px",
      cell: (w) => (
        <span className="font-mono text-xs bg-brand-50 text-brand-700 px-2 py-0.5 rounded border border-brand-100">
          {w.key}
        </span>
      ),
    },
    {
      header: "Name",
      cell: (w) => (
        <a
          href={`/projects/sprints/${w.id}`}
          className="font-medium text-ink hover:text-brand-700"
        >
          {w.name}
        </a>
      ),
    },
    {
      header: "Description",
      cell: (w) => (
        <span className="text-ink-muted text-sm truncate max-w-md block">
          {w.description ?? "—"}
        </span>
      ),
    },
    {
      header: "Sprints",
      align: "right",
      cell: (w) => <span className="tabular-nums text-ink-soft">{w._count.sprints}</span>,
    },
    {
      header: "Epics",
      align: "right",
      cell: (w) => <span className="tabular-nums text-ink-soft">{w._count.epics}</span>,
    },
    {
      header: "Work items",
      align: "right",
      cell: (w) => <span className="tabular-nums text-ink-soft">{w._count.workItems}</span>,
    },
    {
      header: "Status",
      cell: (w) =>
        w.isActive ? (
          <span className="badge-green">Active</span>
        ) : (
          <span className="badge-gray">Archived</span>
        ),
    },
    {
      header: "",
      align: "right",
      cell: (w) => (
        <div className="flex items-center gap-2 justify-end">
          <button
            onClick={() => openEdit(w)}
            className="text-xs text-ink-soft hover:text-brand-700"
          >
            Edit
          </button>
          <button onClick={() => remove(w)} className="text-xs text-red-600 hover:underline">
            Delete
          </button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Home", href: "/" }, { label: "Sprints" }]}
        title="Sprints"
        subtitle={`${rows.length} workspace${rows.length === 1 ? "" : "s"} · run agile teams with backlog, board, epics & OKRs`}
        actions={<Button variant="brand" onClick={openNew}>+ New Workspace</Button>}
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
          search={{ value: search, onChange: setSearch, placeholder: "Search workspaces…" }}
          actions={<SavedViewsControls listKey="projects-web:sprints" current={{ search }} onApply={(fv) => setSearch(fv.search)} />}
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(w) => w.id}
          loading={loading}
          empty={{
            icon: Icon.layers,
            title: search ? "No matches" : "No workspaces yet",
            description: search
              ? "Try a different search."
              : "Group a team's sprints, epics, work items and OKRs under a workspace with its own key prefix.",
            action: !search && (
              <Button variant="brand" onClick={openNew}>
                Create your first workspace
              </Button>
            ),
          }}
        />
      </div>

      <Drawer
        open={showEditor}
        onClose={() => setShowEditor(false)}
        title={editingId ? "Edit workspace" : "New workspace"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowEditor(false)}>
              Cancel
            </Button>
            <Button
              variant="brand"
              onClick={(e) => save(e as unknown as React.FormEvent)}
              disabled={busy || !form.name.trim() || (!editingId && !form.key.trim())}
            >
              {busy ? "Saving…" : editingId ? "Save changes" : "Create workspace"}
            </Button>
          </>
        }
      >
        <form onSubmit={save} className="space-y-5">
          <FormField label="Name" required error={fieldErrors.name}>
            <input
              className="input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Lumaara Platform"
              required
              autoFocus
            />
          </FormField>
          <FormField
            label="Key"
            required
            hint="2–6 uppercase letters/digits starting with a letter. Immutable after create."
            error={fieldErrors.key}
          >
            <input
              className="input font-mono uppercase"
              value={form.key}
              onChange={(e) =>
                setForm({ ...form, key: e.target.value.toUpperCase().slice(0, 6) })
              }
              placeholder="LUM"
              maxLength={6}
              disabled={!!editingId}
              required={!editingId}
            />
          </FormField>
          <FormField label="Description" error={fieldErrors.description}>
            <textarea
              className="input min-h-[80px]"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Optional"
            />
          </FormField>
          <FormField label="Active" hint="Archived workspaces stay read-only.">
            <label className="inline-flex items-center gap-2 text-sm text-ink-soft">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              />
              Workspace is active
            </label>
          </FormField>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </>
  );
}
