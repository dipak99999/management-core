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

interface Param {
  id?: string;
  parameter: string;
  acceptanceCriteria: string;
  sortOrder: number;
}
interface Template {
  id: string;
  name: string;
  parameters: Param[];
}

const emptyParam: Param = { parameter: "", acceptanceCriteria: "", sortOrder: 0 };

export default function QITemplatesPage() {
  const [rows, setRows] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [params, setParams] = useState<Param[]>([{ ...emptyParam }]);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  async function load() {
    setLoading(true);
    try {
      setRows(await api.get<Template[]>("/quality-inspection-templates"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  useListPageCommands({
    singular: "Quality Inspection Template",
    plural: "Quality Inspection Templates",
    refresh: load,
  });
  function edit(t: Template) {
    setName(t.name);
    setParams(
      t.parameters.length
        ? t.parameters.map((p, i) => ({
            parameter: p.parameter,
            acceptanceCriteria: p.acceptanceCriteria ?? "",
            sortOrder: p.sortOrder ?? i,
          }))
        : [{ ...emptyParam }],
    );
    setEditingId(t.id);
    setShowForm(true);
  }
  function close() {
    setName("");
    setParams([{ ...emptyParam }]);
    setEditingId(null);
    setShowForm(false);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const body = {
        name,
        parameters: params
          .filter((p) => p.parameter.trim())
          .map((p, i) => ({
            parameter: p.parameter.trim(),
            acceptanceCriteria: p.acceptanceCriteria.trim() || null,
            sortOrder: p.sortOrder || i,
          })),
      };
      if (editingId) await api.put(`/quality-inspection-templates/${editingId}`, body);
      else await api.post("/quality-inspection-templates", body);
      close();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this template?")) return;
    try {
      await api.del(`/quality-inspection-templates/${id}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(q));
  }, [rows, search]);

  const columns: Column<Template>[] = [
    { header: "Template", cell: (t) => <span className="font-medium text-ink">{t.name}</span> },
    {
      header: "Parameters",
      cell: (t) => (
        <span className="text-xs text-ink-muted">{t.parameters.map((p) => p.parameter).join(", ")}</span>
      ),
    },
    {
      header: "",
      align: "right",
      cell: (t) => (
        <span className="space-x-2">
          <button onClick={(e) => { e.stopPropagation(); edit(t); }} className="btn-ghost btn-sm">Edit</button>
          <button onClick={(e) => { e.stopPropagation(); remove(t.id); }} className="btn-ghost btn-sm text-red-600">Delete</button>
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="QI Templates"
        subtitle={`${rows.length} template${rows.length === 1 ? "" : "s"}`}
        actions={
          <Button variant="brand" onClick={() => setShowForm(true)}>+ New template</Button>
        }
      />

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}

      <div className="space-y-4">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search templates…" }}
          actions={<SavedViewsControls listKey="stock-web:quality-inspection-templates" current={{ search }} onApply={(fv) => setSearch(fv.search)} />}
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(t) => t.id}
          loading={loading}
          empty={{
            icon: Icon.shield,
            title: search ? "No matches" : "No QI templates yet",
            description: search
              ? "Try a different search term."
              : "Define reusable parameter sets for quality inspections.",
            action: !search && (
              <Button variant="brand" onClick={() => setShowForm(true)}>+ Add template</Button>
            ),
          }}
        />
      </div>

      <Drawer
        open={showForm}
        onClose={close}
        title={editingId ? "Edit template" : "New template"}
        width="w-[640px]"
        footer={
          <>
            <Button variant="secondary" onClick={close}>Cancel</Button>
            <Button variant="brand" onClick={(e) => save(e as unknown as React.FormEvent)}>
              {editingId ? "Save changes" : "Create template"}
            </Button>
          </>
        }
      >
        <form onSubmit={save} className="space-y-4">
          <FormField label="Template name" required>
            <input
              required
              className="input"
              placeholder="e.g. Incoming Inspection – Widgets"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </FormField>
          <div>
            <label className="label">Parameters</label>
            <table className="w-full text-sm">
              <thead className="text-ink-muted text-start text-xs">
                <tr>
                  <th className="py-1">Parameter</th>
                  <th className="py-1">Acceptance criteria</th>
                  <th className="py-1 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {params.map((p, idx) => (
                  <tr key={idx}>
                    <td className="py-1 pe-2">
                      <input
                        className="input"
                        placeholder="Moisture %"
                        value={p.parameter}
                        onChange={(e) =>
                          setParams((ps) =>
                            ps.map((x, i) => (i === idx ? { ...x, parameter: e.target.value } : x)),
                          )
                        }
                      />
                    </td>
                    <td className="py-1 pe-2">
                      <input
                        className="input"
                        placeholder="≥ 95%"
                        value={p.acceptanceCriteria}
                        onChange={(e) =>
                          setParams((ps) =>
                            ps.map((x, i) =>
                              i === idx ? { ...x, acceptanceCriteria: e.target.value } : x,
                            ),
                          )
                        }
                      />
                    </td>
                    <td className="py-1 text-end">
                      <button
                        type="button"
                        onClick={() =>
                          setParams((ps) => (ps.length > 1 ? ps.filter((_, i) => i !== idx) : ps))
                        }
                        className="text-xs text-red-600"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button
              type="button"
              onClick={() => setParams([...params, { ...emptyParam, sortOrder: params.length }])}
              className="btn-ghost btn-sm mt-2"
            >
              + Add parameter
            </button>
          </div>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </>
  );
}
