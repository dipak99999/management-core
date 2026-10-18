"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useT } from "@lumaara/web-i18n";
import { api } from "../../lib/api";
import { loadSession } from "../../lib/auth";
import { AppShell, Icon } from "../../components/app-shell";
import { SHELL_NAV } from "../../components/shell-nav";
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

interface Todo {
  id: string;
  description: string;
  dueDate: string | null;
  priority: "Low" | "Medium" | "High";
  doctype: string | null;
  docId: string | null;
  isDone: boolean;
  completedAt: string | null;
  createdAt: string;
}

const PRIORITY = ["Low", "Medium", "High"] as const;
type StatusFilter = "open" | "done" | "all";

const emptyForm = {
  description: "",
  dueDate: "",
  priority: "Medium" as (typeof PRIORITY)[number],
};

function priorityBadgeClass(p: string): string {
  return p === "High"
    ? "badge-red"
    : p === "Low"
      ? "badge-gray"
      : "badge-amber";
}

export default function TodosPage() {
  // Local alias `tr` because this file already binds `t` to a Todo row
  // inside DataTable cell callbacks — avoid the shadow.
  const tr = useT();
  const [rows, setRows] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>("open");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const qs = filter === "all" ? "" : `?status=${filter}`;
      const rs = await api.get<Todo[]>(`/todos${qs}`);
      setRows(rs);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    if (!loadSession()) {
      location.href = "/login";
      return;
    }
    refresh();
  }, [refresh]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.description.trim()) return;
    setBusy(true);
    try {
      const row = await api.post<Todo>("/todos", {
        description: form.description.trim(),
        dueDate: form.dueDate || undefined,
        priority: form.priority,
      });
      setRows((rs) => [row, ...rs]);
      setForm(emptyForm);
      setShowForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(t: Todo, e: React.MouseEvent) {
    e.stopPropagation();
    const row = await api.put<Todo>(`/todos/${t.id}`, { isDone: !t.isDone });
    setRows((rs) => rs.map((r) => (r.id === t.id ? row : r)));
  }

  async function remove(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm("Delete this todo?")) return;
    await api.delete(`/todos/${id}`);
    setRows((rs) => rs.filter((r) => r.id !== id));
  }

  const counts = useMemo(() => ({
    open: rows.filter((r) => !r.isDone).length,
    done: rows.filter((r) => r.isDone).length,
    all: rows.length,
  }), [rows]);

  const columns: Column<Todo>[] = [
    {
      header: "",
      width: "44px",
      cell: (t) => (
        <input
          type="checkbox"
          checked={t.isDone}
          onChange={() => {}}
          onClick={(e) => toggle(t, e)}
        />
      ),
    },
    {
      header: tr("Description"),
      cell: (t) => (
        <span className={t.isDone ? "text-ink-muted line-through" : "text-ink font-medium"}>
          {t.description}
        </span>
      ),
    },
    {
      header: tr("Priority"),
      cell: (t) => <span className={priorityBadgeClass(t.priority)}>{tr(t.priority)}</span>,
    },
    {
      header: tr("Due date"),
      cell: (t) => <span className="text-ink-soft">{dateShort(t.dueDate)}</span>,
    },
    {
      header: "Reference",
      cell: (t) =>
        t.doctype && t.docId ? (
          <span className="text-xs text-ink-muted font-mono">{t.doctype}/{t.docId.slice(0, 8)}</span>
        ) : (
          <span className="text-ink-muted">—</span>
        ),
    },
    {
      header: "",
      align: "right",
      cell: (t) => (
        <button
          onClick={(e) => remove(t.id, e)}
          className="text-xs text-red-600 hover:underline"
        >
          {tr("Delete")}
        </button>
      ),
    },
  ];

  return (
    <AppShell moduleName="Home" nav={SHELL_NAV}>
      <PageHeader
        title="My Todos"
        subtitle={`${counts.open} open · ${counts.done} done`}
        actions={
          <Button variant="brand" onClick={() => setShowForm(true)}>
            + New todo
          </Button>
        }
      />

      {error && (
        <div className="mb-4">
          <Toast kind="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      <div className="space-y-4">
        <FilterBar
          filters={
            <Segmented
              value={filter}
              onChange={setFilter}
              options={[
                { value: "open", label: tr("Open"), count: counts.open },
                { value: "done", label: tr("Done"), count: counts.done },
                { value: "all",  label: tr("All"),  count: counts.all },
              ]}
            />
          }
        />

        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(t) => t.id}
          loading={loading}
          empty={{
            icon: Icon.clipboard,
            title: filter === "done" ? "No completed todos" : "Nothing here",
            description:
              filter === "open"
                ? "Add a todo to get started."
                : "Try changing the filter.",
            action: filter !== "done" && (
              <Button variant="brand" onClick={() => setShowForm(true)}>
                + New todo
              </Button>
            ),
          }}
        />
      </div>

      <Drawer
        open={showForm}
        onClose={() => setShowForm(false)}
        title="New todo"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowForm(false)}>{tr("Cancel")}</Button>
            <Button
              variant="brand"
              onClick={(e) => onCreate(e as unknown as React.FormEvent)}
              disabled={busy}
            >
              {busy ? tr("Loading") : tr("Add")}
            </Button>
          </>
        }
      >
        <form onSubmit={onCreate} className="space-y-4">
          <FormField label={tr("Description")} required>
            <input
              className="input"
              placeholder="What needs to happen?"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              required
              autoFocus
            />
          </FormField>
          <FormField label={tr("Due date")}>
            <input
              type="date"
              className="input"
              value={form.dueDate}
              onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
            />
          </FormField>
          <FormField label={tr("Priority")}>
            <select
              className="input"
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: e.target.value as (typeof PRIORITY)[number] })}
            >
              {PRIORITY.map((p) => (
                <option key={p} value={p}>{tr(p)}</option>
              ))}
            </select>
          </FormField>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </AppShell>
  );
}
