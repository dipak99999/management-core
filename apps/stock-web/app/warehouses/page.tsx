"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useListPageCommands, SavedViewsControls } from "@lumaara/web-ui";
import { useSearchParams } from "next/navigation";
import { buildTree } from "@lumaara/db/tree";
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
  type Column,
} from "../../components/ui";
import { Icon } from "../../components/app-shell";
import { TreeView } from "../../components/tree-view";

interface Warehouse {
  id: string;
  warehouseName: string;
  parentId: string | null;
  isGroup: boolean;
  disabled?: boolean;
}

type ViewMode = "list" | "tree";

const emptyForm = { warehouseName: "", parentId: "", isGroup: false, disabled: false };

function InnerWarehousesPage() {
  const searchParams = useSearchParams();
  const editId = searchParams.get("editId");

  const [rows, setRows] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<ViewMode>("tree");

  async function load() {
    setLoading(true);
    try {
      setRows(await api.get<Warehouse[]>("/warehouses"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  useListPageCommands({
    singular: "Warehous",
    plural: "Warehouses",
    refresh: load,
  });
  useEffect(() => {
    if (!editId) return;
    api
      .get<Warehouse>(`/warehouses/${editId}`)
      .then((w) => {
        setForm({
          warehouseName: w.warehouseName,
          parentId: w.parentId ?? "",
          isGroup: w.isGroup,
          disabled: w.disabled ?? false,
        });
        setEditingId(editId);
        setShowForm(true);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [editId]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const body = {
        warehouseName: form.warehouseName,
        parentId: form.parentId || null,
        isGroup: form.isGroup,
        disabled: form.disabled,
      };
      if (editingId) {
        await api.put(`/warehouses/${editingId}`, body);
      } else {
        await api.post("/warehouses", body);
      }
      close();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    }
  }

  function close() {
    setForm(emptyForm);
    setEditingId(null);
    setShowForm(false);
    if (editId) window.history.replaceState({}, "", "/stock/warehouses");
  }

  const groups = rows.filter((r) => r.isGroup && r.id !== editingId);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((w) => w.warehouseName.toLowerCase().includes(q));
  }, [rows, search]);

  // Tree view — build from flat rows client-side. Search filters the rows
  // *before* tree-building so a hit deep in the hierarchy pulls its
  // ancestors along naturally (filterTree preserves the path).
  const treeNodes = useMemo(
    () => buildTree(filtered, (w) => w.id, (w) => w.parentId),
    [filtered],
  );

  const columns: Column<Warehouse>[] = [
    {
      header: "Name",
      cell: (w) => (
        <a
          href={`/stock/warehouses/${w.id}`}
          className="font-medium text-ink hover:text-brand-700"
          onClick={(e) => e.stopPropagation()}
        >
          {w.warehouseName}
        </a>
      ),
    },
    {
      header: "Parent",
      cell: (w) => (
        <span className="text-ink-soft">
          {rows.find((r) => r.id === w.parentId)?.warehouseName ?? "—"}
        </span>
      ),
    },
    {
      header: "Type",
      cell: (w) => (
        <span className={w.isGroup ? "badge-brand" : "badge-gray"}>
          {w.isGroup ? "Group" : "Leaf"}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Warehouses"
        subtitle={`${rows.length} warehouse${rows.length === 1 ? "" : "s"}`}
        actions={
          <Button variant="brand" onClick={() => setShowForm(true)}>
            + New warehouse
          </Button>
        }
      />

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}

      <div className="space-y-4">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search warehouses…" }}
          actions={
            <>
              <Segmented<ViewMode>
                value={view}
                onChange={setView}
                options={[
                  { value: "tree", label: "Tree" },
                  { value: "list", label: "List" },
                ]}
              />
              <SavedViewsControls
                listKey="stock-web:warehouses"
                current={{ search, view }}
                onApply={(fv) => { setSearch(fv.search); setView(fv.view); }}
              />
            </>
          }
        />
        {view === "tree" ? (
          <div className="card p-4">
            <TreeView<Warehouse>
              nodes={treeNodes}
              rowKey={(w) => w.id}
              onRowClick={(w) =>
                (window.location.href = `/stock/warehouses/${w.id}`)
              }
              renderRow={(w) => (
                <div className="flex items-center gap-2 min-w-0">
                  <span className={w.isGroup ? "font-semibold text-ink" : "text-ink"}>
                    {w.warehouseName}
                  </span>
                  {w.isGroup && <span className="badge-brand text-[10px]">Group</span>}
                  {w.disabled && (
                    <span className="badge-gray text-[10px]">Disabled</span>
                  )}
                </div>
              )}
              emptyMessage={
                search
                  ? "No warehouses match your search."
                  : "Add your first warehouse to start tracking stock."
              }
            />
          </div>
        ) : (
          <DataTable
            columns={columns}
            rows={filtered}
            rowKey={(w) => w.id}
            onRowClick={(w) => (window.location.href = `/stock/warehouses/${w.id}`)}
            loading={loading}
            empty={{
              icon: Icon.box,
              title: search ? "No matches" : "No warehouses yet",
              description: search
                ? "Try a different search term."
                : "Add your first warehouse to start tracking stock.",
              action: !search && (
                <Button variant="brand" onClick={() => setShowForm(true)}>+ Add warehouse</Button>
              ),
            }}
          />
        )}
      </div>

      <Drawer
        open={showForm}
        onClose={close}
        title={editingId ? "Edit warehouse" : "New warehouse"}
        footer={
          <>
            <Button variant="secondary" onClick={close}>Cancel</Button>
            <Button variant="brand" onClick={(e) => save(e as unknown as React.FormEvent)}>
              {editingId ? "Save changes" : "Create warehouse"}
            </Button>
          </>
        }
      >
        <form onSubmit={save} className="space-y-4">
          <FormField label="Warehouse name" required>
            <input
              className="input"
              placeholder="Main Store"
              value={form.warehouseName}
              onChange={(e) => setForm({ ...form, warehouseName: e.target.value })}
              required
              autoFocus
            />
          </FormField>
          <FormField label="Parent">
            <select
              className="input"
              value={form.parentId}
              onChange={(e) => setForm({ ...form, parentId: e.target.value })}
            >
              <option value="">No parent (root)</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.warehouseName}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Is group" hint="Cannot receive stock; used to organise leaf warehouses.">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isGroup}
                onChange={(e) => setForm({ ...form, isGroup: e.target.checked })}
              />
              Group warehouse
            </label>
          </FormField>
          <FormField label="Disabled" hint="Hidden from selectors.">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.disabled}
                onChange={(e) => setForm({ ...form, disabled: e.target.checked })}
              />
              Disabled
            </label>
          </FormField>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </>
  );
}

export default function WarehousesPage() {
  return (
    <Suspense fallback={null}>
      <InnerWarehousesPage />
    </Suspense>
  );
}
