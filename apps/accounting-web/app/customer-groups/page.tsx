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

interface Group {
  id: string;
  groupName: string;
  parentId: string | null;
  isGroup: boolean;
}
const empty = { groupName: "", parentId: "", isGroup: false };

export default function CustomerGroupsPage() {
  const [rows, setRows] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  async function load() {
    setLoading(true);
    try {
      setRows(await api.get<Group[]>("/customer-groups"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  useListPageCommands({
    singular: "Customer Group",
    plural: "Customer Groups",
    refresh: load,
  });
  function edit(g: Group, e: React.MouseEvent) {
    e.stopPropagation();
    setForm({
      groupName: g.groupName,
      parentId: g.parentId ?? "",
      isGroup: g.isGroup,
    });
    setEditingId(g.id);
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
      if (editingId) await api.put(`/customer-groups/${editingId}`, body);
      else await api.post("/customer-groups", body);
      close();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    }
  }

  async function remove(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm("Delete this group?")) return;
    try {
      await api.del(`/customer-groups/${id}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  const groupsOnly = useMemo(() => rows.filter((r) => r.isGroup), [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.groupName.toLowerCase().includes(q));
  }, [rows, search]);

  const columns: Column<Group>[] = [
    {
      header: "Name",
      cell: (r) => (
        <span className={r.isGroup ? "font-semibold text-ink" : "text-ink"}>
          {r.groupName}
        </span>
      ),
    },
    {
      header: "Parent",
      cell: (r) => (
        <span className="text-ink-soft">
          {rows.find((x) => x.id === r.parentId)?.groupName ?? "—"}
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
        title="Customer Groups"
        subtitle={`${rows.length} group${rows.length === 1 ? "" : "s"} · ${groupsOnly.length} parent group${groupsOnly.length === 1 ? "" : "s"}`}
        actions={
          <Button variant="brand" onClick={() => setShowForm(true)}>+ New group</Button>
        }
      />

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}

      <div className="space-y-4">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search groups…" }}
          actions={<SavedViewsControls listKey="accounting-web:customer-groups" current={{ search }} onApply={(fv) => setSearch(fv.search)} />}
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.id}
          loading={loading}
          empty={{
            icon: Icon.users,
            title: search ? "No matching groups" : "No customer groups yet",
            description: search
              ? "Try a different search term."
              : "Organize customers into hierarchical groups.",
            action: !search && (
              <Button variant="brand" onClick={() => setShowForm(true)}>+ Add group</Button>
            ),
          }}
        />
      </div>

      <Drawer
        open={showForm}
        onClose={close}
        title={editingId ? "Edit customer group" : "New customer group"}
        footer={
          <>
            <Button variant="secondary" onClick={close}>Cancel</Button>
            <Button variant="brand" onClick={(e) => save(e as unknown as React.FormEvent)}>
              {editingId ? "Save changes" : "Create group"}
            </Button>
          </>
        }
      >
        <form onSubmit={save} className="space-y-4">
          <FormField label="Group name" required>
            <input
              required
              className="input"
              placeholder="e.g. Wholesale"
              value={form.groupName}
              onChange={(e) => setForm({ ...form, groupName: e.target.value })}
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
                <option key={g.id} value={g.id}>{g.groupName}</option>
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
