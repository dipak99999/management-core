"use client";

import { useEffect, useMemo, useState } from "react";
import { useListPageCommands } from "@lumaara/web-ui";
import { buildTree } from "@lumaara/db/tree";
import { api } from "../../lib/api";
import {
  Button,
  Card,
  DataTable,
  FormField,
  PageHeader,
  SectionHeader,
  Segmented,
  StatusBadge,
  money,
  type Column,
} from "../../components/ui";
import { TreeView } from "../../components/tree-view";

type ViewMode = "list" | "tree";

interface CostCenter {
  id: string;
  name: string;
  code: string | null;
  parentId: string | null;
  isGroup: boolean;
  disabled: boolean;
  budget: string | null;
  parent: { name: string } | null;
}

export default function CostCentersPage() {
  const [rows, setRows] = useState<CostCenter[]>([]);
  const [form, setForm] = useState({ name: "", code: "", parentId: "", isGroup: false, budget: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("tree");

  async function load() {
    try {
      setRows(await api.get<CostCenter[]>("/cost-centers"));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => {
    load();
  }, []);

  useListPageCommands({
    singular: "Cost Center",
    plural: "Cost Centers",
    refresh: load,
  });

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.post("/cost-centers", {
        name: form.name,
        code: form.code || null,
        parentId: form.parentId || null,
        isGroup: form.isGroup,
        budget: form.budget ? Number(form.budget) : null,
      });
      setForm({ name: "", code: "", parentId: "", isGroup: false, budget: "" });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this cost center?")) return;
    try {
      await api.del(`/cost-centers/${id}`);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    }
  }

  const groups = rows.filter((r) => r.isGroup);
  const treeNodes = useMemo(
    () => buildTree(rows, (r) => r.id, (r) => r.parentId),
    [rows],
  );

  const columns: Column<CostCenter>[] = [
    { header: "Name", cell: (r) => (r.isGroup ? <strong>{r.name}</strong> : r.name) },
    { header: "Code", cell: (r) => r.code ?? "—" },
    { header: "Parent", cell: (r) => r.parent?.name ?? "—" },
    {
      header: "Type",
      cell: (r) => <StatusBadge status={r.isGroup ? "Group" : "Leaf"} />,
    },
    { header: "Budget", align: "right", cell: (r) => (r.budget ? money(Number(r.budget)) : "—") },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <Button variant="ghost" size="sm" onClick={() => remove(r.id)}>
          Delete
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Accounting", href: "/" }, { label: "Cost Centers" }]}
        title="Cost Centers"
        subtitle="Hierarchical spend units · used by Cost Center Analysis + Allocation dashboards"
      />
      {err && <div className="mb-4 p-3 rounded bg-red-50 border border-red-200 text-red-800 text-sm">{err}</div>}
      <Card className="p-4 mb-4">
        <SectionHeader title="New cost center" />
        <form onSubmit={create} className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <FormField label="Name" required>
            <input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </FormField>
          <FormField label="Code">
            <input className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          </FormField>
          <FormField label="Parent">
            <select className="input" value={form.parentId} onChange={(e) => setForm({ ...form, parentId: e.target.value })}>
              <option value="">Root</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Type">
            <select
              className="input"
              value={form.isGroup ? "group" : "leaf"}
              onChange={(e) => setForm({ ...form, isGroup: e.target.value === "group" })}
            >
              <option value="leaf">Leaf</option>
              <option value="group">Group</option>
            </select>
          </FormField>
          <FormField label="Budget">
            <input
              type="number"
              step="0.01"
              className="input"
              value={form.budget}
              onChange={(e) => setForm({ ...form, budget: e.target.value })}
            />
          </FormField>
          <div className="flex items-end">
            <Button variant="brand" type="submit" disabled={busy} className="w-full">
              {busy ? "Saving…" : "Create"}
            </Button>
          </div>
        </form>
      </Card>
      <div className="flex justify-end mb-3">
        <Segmented<ViewMode>
          value={view}
          onChange={setView}
          options={[
            { value: "tree", label: "Tree" },
            { value: "list", label: "List" },
          ]}
        />
      </div>
      <Card className={view === "tree" ? "p-4" : "p-0 overflow-hidden"}>
        {view === "tree" ? (
          <TreeView<CostCenter>
            nodes={treeNodes}
            rowKey={(r) => r.id}
            renderRow={(r) => (
              <div className="flex items-center gap-2 min-w-0">
                <span className={r.isGroup ? "font-semibold text-ink" : "text-ink"}>
                  {r.name}
                </span>
                {r.code && (
                  <span className="text-xs text-ink-muted font-mono">
                    {r.code}
                  </span>
                )}
                {r.isGroup && <span className="badge-brand text-[10px]">Group</span>}
                {r.disabled && (
                  <span className="badge-gray text-[10px]">Disabled</span>
                )}
                {r.budget && (
                  <span className="ms-auto text-xs text-ink-soft tabular-nums">
                    {money(Number(r.budget))}
                  </span>
                )}
              </div>
            )}
            emptyMessage="No cost centers yet."
          />
        ) : (
          <DataTable
            rows={rows}
            columns={columns}
            rowKey={(r) => r.id}
            empty={{ title: "No cost centers yet." }}
          />
        )}
      </Card>
    </>
  );
}
