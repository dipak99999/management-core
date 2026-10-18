"use client";

import { useEffect, useMemo, useState } from "react";
import { useListPageCommands, SavedViewsControls } from "@lumaara/web-ui";
import { api } from "../../../lib/api";
import { AppShell, Icon } from "../../../components/app-shell";
import { SHELL_NAV } from "../../../components/shell-nav";
import {
  Button,
  DataTable,
  Drawer,
  FilterBar,
  FormField,
  PageHeader,
  StatusBadge,
  Toast,
  type Column,
} from "../../../components/ui";

interface WorkflowRow {
  id: string;
  name: string;
  doctype: string;
  isActive: boolean;
  _count: { states: number; transitions: number };
}
interface Meta {
  doctypes: string[];
}

export default function WorkflowsListPage() {
  const [rows, setRows] = useState<WorkflowRow[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", doctype: "" });
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");

  async function load() {
    setLoading(true);
    try {
      const [ws, m] = await Promise.all([
        api.get<WorkflowRow[]>("/workflows"),
        api.get<Meta>("/workflows/meta"),
      ]);
      setRows(ws);
      setMeta(m);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  useListPageCommands({
    singular: "Workflow",
    plural: "Workflows",
    refresh: load,
  });
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const w = await api.post<WorkflowRow>("/workflows", {
        name: form.name,
        doctype: form.doctype,
      });
      setForm({ name: "", doctype: "" });
      window.location.href = `/admin/workflows/${w.id}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create");
    } finally {
      setBusy(false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.name, r.doctype].some((v) => v.toLowerCase().includes(q)),
    );
  }, [rows, search]);

  const columns: Column<WorkflowRow>[] = [
    {
      header: "Name",
      cell: (w) => (
        <a
          href={`/admin/workflows/${w.id}`}
          className="font-medium text-ink hover:text-brand-700"
          onClick={(e) => e.stopPropagation()}
        >
          {w.name}
        </a>
      ),
    },
    { header: "Doctype", cell: (w) => <span className="font-mono text-xs text-ink-soft">{w.doctype}</span> },
    {
      header: "Status",
      cell: (w) => <StatusBadge status={w.isActive ? "Active" : "Draft"} />,
    },
    {
      header: "States",
      align: "right",
      cell: (w) => <span className="tabular-nums text-ink-soft">{w._count.states}</span>,
    },
    {
      header: "Transitions",
      align: "right",
      cell: (w) => <span className="tabular-nums text-ink-soft">{w._count.transitions}</span>,
    },
  ];

  return (
    <AppShell moduleName="Home" nav={SHELL_NAV}>
      <PageHeader
        title="Workflows"
        subtitle="A workflow attaches to a doctype and defines a state machine over its status field. When active, transition buttons appear on the doctype's detail page for allowed roles."
        breadcrumb={[{ label: "Admin", href: "/admin" }, { label: "Workflows" }]}
        actions={
          <Button variant="brand" onClick={() => setShowForm(true)}>
            + New workflow
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
          search={{ value: search, onChange: setSearch, placeholder: "Search workflows…" }}
          actions={<SavedViewsControls listKey="shell:admin-workflows" current={{ search }} onApply={(fv) => setSearch(fv.search)} />}
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(w) => w.id}
          onRowClick={(w) => (window.location.href = `/admin/workflows/${w.id}`)}
          loading={loading}
          empty={{
            icon: Icon.layers,
            title: search ? "No matches" : "No workflows yet",
            description: search
              ? "Try a different search term."
              : "Create your first workflow to define state transitions.",
            action: !search && (
              <Button variant="brand" onClick={() => setShowForm(true)}>+ New workflow</Button>
            ),
          }}
        />
      </div>

      <Drawer
        open={showForm}
        onClose={() => setShowForm(false)}
        title="New workflow"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button
              variant="brand"
              onClick={(e) => create(e as unknown as React.FormEvent)}
              disabled={busy}
            >
              {busy ? "Creating…" : "Create workflow"}
            </Button>
          </>
        }
      >
        <form onSubmit={create} className="space-y-4">
          <FormField label="Workflow name" required>
            <input
              className="input"
              placeholder="e.g. Sales Invoice Approval"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              autoFocus
            />
          </FormField>
          <FormField label="Doctype" required>
            <select
              className="input"
              value={form.doctype}
              onChange={(e) => setForm({ ...form, doctype: e.target.value })}
              required
            >
              <option value="">Select doctype…</option>
              {meta?.doctypes.map((dt) => (
                <option key={dt} value={dt}>{dt}</option>
              ))}
            </select>
          </FormField>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </AppShell>
  );
}
