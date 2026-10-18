"use client";

import { useEffect, useState } from "react";
import { useListPageCommands } from "@lumaara/web-ui";
import { api } from "../../lib/api";
import {
  Button,
  DataTable,
  Drawer,
  FormField,
  PageHeader,
  StatusBadge,
  Toast,
  dateShort,
  type Column,
} from "../../components/ui";
import { Icon } from "../../components/app-shell";

interface Onboarding {
  id: string;
  boardingDate: string;
  status: string;
  employee: { employeeCode: string; employeeName: string };
  _count: { tasks: number };
}

interface Employee { id: string; employeeCode: string; employeeName: string; }

// Module 51 — Employee Onboarding list + create.
// Uses the dedicated EmployeeOnboarding lifecycle doctype (distinct
// from the older checklist-based /hr/onboarding page which stays for
// backward compat).
export default function EmployeeOnboardingsPage() {
  const [rows, setRows] = useState<Onboarding[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ employeeId: "", boardingDate: new Date().toISOString().slice(0, 10) });

  async function load() {
    setLoading(true);
    try {
      const [o, e] = await Promise.all([
        api.get<Onboarding[]>("/employee-onboardings"),
        api.get<Employee[]>("/employees"),
      ]);
      setRows(o);
      setEmployees(e);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  useListPageCommands({
    singular: "Onboarding",
    plural: "Onboardings",
    refresh: load,
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/employee-onboardings", {
        employeeId: form.employeeId,
        boardingDate: new Date(form.boardingDate).toISOString(),
      });
      setShowForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  async function start(r: Onboarding, e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await api.post(`/employee-onboardings/${r.id}/start`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  const columns: Column<Onboarding>[] = [
    {
      header: "Employee",
      cell: (r) => (
        <a href={`/hr/onboardings/${r.id}`} className="font-medium text-brand-600 hover:underline">
          {r.employee.employeeName}
          <span className="text-xs font-mono text-ink-muted ms-2">{r.employee.employeeCode}</span>
        </a>
      ),
    },
    { header: "Board date", cell: (r) => <span className="text-sm">{dateShort(r.boardingDate)}</span> },
    { header: "Tasks", align: "right", cell: (r) => <span className="font-mono">{r._count.tasks}</span> },
    { header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
    {
      header: "",
      align: "right",
      cell: (r) => (
        r.status === "Draft" ? (
          <button onClick={(e) => start(r, e)} className="btn-ghost btn-sm">Start</button>
        ) : null
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Employee Onboardings"
        subtitle="Structured task-based new-hire lifecycle. Auto-completes when every task is marked done."
        actions={<Button variant="brand" onClick={() => setShowForm(true)}>+ New onboarding</Button>}
      />

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        loading={loading}
        empty={{
          icon: Icon.clipboard,
          title: "No onboardings yet",
          description: "Kick off structured task lists for new hires.",
          action: <Button variant="brand" onClick={() => setShowForm(true)}>+ New onboarding</Button>,
        }}
      />

      <Drawer
        open={showForm}
        onClose={() => setShowForm(false)}
        title="New employee onboarding"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button variant="brand" onClick={(e) => submit(e as unknown as React.FormEvent)}>Create</Button>
          </>
        }
      >
        <form onSubmit={submit} className="space-y-4">
          <FormField label="Employee" required>
            <select className="input" value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })} required>
              <option value="">— pick —</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.employeeName} ({e.employeeCode})</option>)}
            </select>
          </FormField>
          <FormField label="Board date" required>
            <input type="date" className="input" value={form.boardingDate} onChange={(e) => setForm({ ...form, boardingDate: e.target.value })} required />
          </FormField>
          <div className="text-xs text-ink-muted">Default 7-task checklist will be seeded automatically.</div>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </>
  );
}
