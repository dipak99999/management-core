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
  Segmented,
  StatusBadge,
  Toast,
  dateShort,
  type Column,
} from "../../components/ui";
import { Icon } from "../../components/app-shell";

interface Checklist {
  id: string;
  name: string;
  type: string;
  status: string;
  startDate: string;
  targetDate: string | null;
  employee: { employeeCode: string; employeeName: string };
  _count: { activities: number };
}
interface Employee {
  id: string;
  employeeCode: string;
  employeeName: string;
}
interface Template {
  id: string;
  name: string;
  type: string;
}

type TypeFilter = "all" | "Onboarding" | "Separation";

const emptyForm = {
  type: "Onboarding" as "Onboarding" | "Separation",
  employeeId: "",
  templateId: "",
  targetDate: "",
};

export default function OnboardingPage() {
  const [rows, setRows] = useState<Checklist[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");

  async function load() {
    setLoading(true);
    try {
      const [rs, es, ts] = await Promise.all([
        api.get<Checklist[]>("/employee-checklists"),
        api.get<Employee[]>("/employees"),
        api.get<Template[]>("/employee-checklist-templates"),
      ]);
      setRows(rs);
      setEmployees(es);
      setTemplates(ts);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  useListPageCommands({
    singular: "Onboarding",
    plural: "Onboarding",
    refresh: load,
  });
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/employee-checklists", {
        type: form.type,
        employeeId: form.employeeId,
        templateId: form.templateId || null,
        targetDate: form.targetDate ? new Date(form.targetDate).toISOString() : null,
      });
      setShowForm(false);
      setForm(emptyForm);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const filteredTemplates = templates.filter((t) => t.type === form.type);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (typeFilter !== "all" && r.type !== typeFilter) return false;
      if (q && !`${r.name} ${r.employee.employeeName} ${r.employee.employeeCode}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, search, typeFilter]);

  const counts = useMemo(() => ({
    all:        rows.length,
    Onboarding: rows.filter((r) => r.type === "Onboarding").length,
    Separation: rows.filter((r) => r.type === "Separation").length,
  }), [rows]);

  const columns: Column<Checklist>[] = [
    {
      header: "Name",
      cell: (r) => (
        <a
          href={`/hr/onboarding/${r.id}`}
          className="font-mono text-sm text-brand-600 hover:text-brand-700"
          onClick={(e) => e.stopPropagation()}
        >
          {r.name}
        </a>
      ),
    },
    { header: "Type", cell: (r) => <span className="text-ink-soft">{r.type}</span> },
    {
      header: "Employee",
      cell: (r) => (
        <div>
          <div className="font-medium text-ink">{r.employee.employeeName}</div>
          <div className="text-xs text-ink-muted font-mono">{r.employee.employeeCode}</div>
        </div>
      ),
    },
    {
      header: "Steps",
      align: "right",
      cell: (r) => <span className="tabular-nums text-ink">{r._count.activities}</span>,
    },
    {
      header: "Target",
      cell: (r) => <span className="text-ink-soft">{r.targetDate ? dateShort(r.targetDate) : "—"}</span>,
    },
    { header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <>
      <PageHeader
        title="Onboarding & Separation"
        subtitle={`${rows.length} checklist${rows.length === 1 ? "" : "s"}`}
        actions={
          <>
            <a href="/hr/onboarding/templates" className="btn-secondary">Manage templates</a>
            <Button variant="brand" onClick={() => setShowForm(true)}>+ New checklist</Button>
          </>
        }
      />

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}

      <div className="space-y-4">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search checklist or employee…" }}
          filters={
            <Segmented
              value={typeFilter}
              onChange={setTypeFilter}
              options={[
                { value: "all",        label: "All",        count: counts.all },
                { value: "Onboarding", label: "Onboarding", count: counts.Onboarding },
                { value: "Separation", label: "Separation", count: counts.Separation },
              ]}
            />
          }
          actions={<SavedViewsControls listKey="hr-web:onboarding" current={{ search, typeFilter }} onApply={(fv) => { setSearch(fv.search); setTypeFilter(fv.typeFilter); }} />}
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.id}
          onRowClick={(r) => (window.location.href = `/hr/onboarding/${r.id}`)}
          loading={loading}
          empty={{
            icon: Icon.clipboard,
            title: search || typeFilter !== "all" ? "No matching checklists" : "No checklists yet",
            description: search || typeFilter !== "all"
              ? "Try changing your search or filter."
              : "Start an onboarding or separation checklist from a template.",
            action: !search && typeFilter === "all" && (
              <Button variant="brand" onClick={() => setShowForm(true)}>+ New checklist</Button>
            ),
          }}
        />
      </div>

      <Drawer
        open={showForm}
        onClose={() => { setShowForm(false); setForm(emptyForm); }}
        title="New checklist"
        footer={
          <>
            <Button variant="secondary" onClick={() => { setShowForm(false); setForm(emptyForm); }}>Cancel</Button>
            <Button variant="brand" disabled={busy} onClick={(e) => create(e as unknown as React.FormEvent)}>
              {busy ? "Creating…" : "Create checklist"}
            </Button>
          </>
        }
      >
        <form onSubmit={create} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Type">
              <select
                className="input"
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value as "Onboarding" | "Separation", templateId: "" })}
              >
                <option value="Onboarding">Onboarding</option>
                <option value="Separation">Separation</option>
              </select>
            </FormField>
            <FormField label="Target date">
              <input
                type="date"
                className="input"
                value={form.targetDate}
                onChange={(e) => setForm({ ...form, targetDate: e.target.value })}
              />
            </FormField>
          </div>
          <FormField label="Employee" required>
            <select
              className="input"
              value={form.employeeId}
              onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
              required
            >
              <option value="">Select…</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>{e.employeeCode} — {e.employeeName}</option>
              ))}
            </select>
          </FormField>
          <FormField label="Template" required>
            <select
              className="input"
              value={form.templateId}
              onChange={(e) => setForm({ ...form, templateId: e.target.value })}
              required
            >
              <option value="">Select…</option>
              {filteredTemplates.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </FormField>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </>
  );
}
