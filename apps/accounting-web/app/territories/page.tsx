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

interface T {
  id: string;
  territoryName: string;
  parentId: string | null;
  isGroup: boolean;
}
const empty = { territoryName: "", parentId: "", isGroup: false };

export default function TerritoriesPage() {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  async function load() {
    setLoading(true);
    try {
      setRows(await api.get<T[]>("/territories"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  useListPageCommands({
    singular: "Territory",
    plural: "Territories",
    refresh: load,
  });
  function edit(t: T, e: React.MouseEvent) {
    e.stopPropagation();
    setForm({
      territoryName: t.territoryName,
      parentId: t.parentId ?? "",
      isGroup: t.isGroup,
    });
    setEditingId(t.id);
    setShowForm(true);
  }

  function close() {
    setForm(empty);
    setEditingId(null);
    setShowForm(false);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const body = { ...form, parentId: form.parentId || null };
      if (editingId) await api.put(`/territories/${editingId}`, body);
      else await api.post("/territories", body);
      close();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    }
  }

  async function remove(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm("Delete this territory?")) return;
    try {
      await api.del(`/territories/${id}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  const groupsOnly = useMemo(() => rows.filter((r) => r.isGroup), [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.territoryName.toLowerCase().includes(q));
  }, [rows, search]);

  const columns: Column<T>[] = [
    {
      header: "Name",
      cell: (r) => (
        <span className={r.isGroup ? "font-semibold text-ink" : "text-ink"}>
          {r.territoryName}
        </span>
      ),
    },
    {
      header: "Parent",
      cell: (r) => (
        <span className="text-ink-soft">
          {rows.find((x) => x.id === r.parentId)?.territoryName ?? "—"}
        </span>
      ),
    },
    {
      header: "Type",
      cell: (r) => (
        <span className={r.isGroup ? "badge-brand" : "badge-gray"}>
          {r.isGroup ? "Group" : "Leaf"}
        </span>
      ),
    },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <div className="flex items-center justify-end gap-2">
          <button onClick={(e) => edit(r, e)} className="btn-ghost btn-sm">Edit</button>
          <button onClick={(e) => remove(r.id, e)} className="btn-ghost btn-sm text-red-600">Delete</button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Territories"
        subtitle={`${rows.length} territor${rows.length === 1 ? "y" : "ies"} · ${groupsOnly.length} parent group${groupsOnly.length === 1 ? "" : "s"}`}
        actions={
          <Button variant="brand" onClick={() => setShowForm(true)}>+ New territory</Button>
        }
      />

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}

      <div className="space-y-4">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search territories…" }}
          actions={<SavedViewsControls listKey="accounting-web:territories" current={{ search }} onApply={(fv) => setSearch(fv.search)} />}
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.id}
          loading={loading}
          empty={{
            icon: Icon.target,
            title: search ? "No matching territories" : "No territories yet",
            description: search
              ? "Try a different search term."
              : "Organize customers into geographic territories.",
            action: !search && (
              <Button variant="brand" onClick={() => setShowForm(true)}>+ Add territory</Button>
            ),
          }}
        />
      </div>

      <Drawer
        open={showForm}
        onClose={close}
        title={editingId ? "Edit territory" : "New territory"}
        footer={
          <>
            <Button variant="secondary" onClick={close}>Cancel</Button>
            <Button variant="brand" onClick={(e) => save(e as unknown as React.FormEvent)}>
              {editingId ? "Save changes" : "Create territory"}
            </Button>
          </>
        }
      >
        <form onSubmit={save} className="space-y-4">
          <FormField label="Territory name" required>
            <input
              required
              className="input"
              placeholder="e.g. North India"
              value={form.territoryName}
              onChange={(e) => setForm({ ...form, territoryName: e.target.value })}
              autoFocus
            />
          </FormField>
          <FormField label="Parent">
            <select
              className="input"
              value={form.parentId}
              onChange={(e) => setForm({ ...form, parentId: e.target.value })}
            >
              <option value="">— No parent (root) —</option>
              {groupsOnly.map((g) => (
                <option key={g.id} value={g.id}>{g.territoryName}</option>
              ))}
            </select>
          </FormField>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isGroup}
              onChange={(e) => setForm({ ...form, isGroup: e.target.checked })}
            />
            Is a group (can have children)
          </label>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </>
  );
}
