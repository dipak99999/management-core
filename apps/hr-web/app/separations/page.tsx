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

interface Separation {
  id: string;
  separationDate: string;
  reason: string | null;
  status: string;
  employee: { employeeCode: string; employeeName: string };
  _count: { tasks: number };
}

interface Employee { id: string; employeeCode: string; employeeName: string; }

// Module 51 — Employee Separation list + create.
export default function EmployeeSeparationsPage() {
  const [rows, setRows] = useState<Separation[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    employeeId: "",
    separationDate: new Date().toISOString().slice(0, 10),
    reason: "Resignation",
  });

  async function load() {
    setLoading(true);
    try {
      const [s, e] = await Promise.all([
        api.get<Separation[]>("/employee-separations"),
        api.get<Employee[]>("/employees"),
      ]);
      setRows(s);
      setEmployees(e);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  useListPageCommands({
    singular: "Separation",
    plural: "Separations",
    refresh: load,
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/employee-separations", {
        employeeId: form.employeeId,
        separationDate: new Date(form.separationDate).toISOString(),
        reason: form.reason,
      });
      setShowForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  async function start(r: Separation, e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await api.post(`/employee-separations/${r.id}/start`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  const columns: Column<Separation>[] = [
    {
      header: "Employee",
      cell: (r) => (
        <div>
          <div className="font-medium text-ink">{r.employee.employeeName}</div>
          <div className="text-xs font-mono text-ink-muted">{r.employee.employeeCode}</div>
        </div>
      ),
    },
    { header: "Reason", cell: (r) => <span className="text-sm">{r.reason ?? "—"}</span> },
    { header: "Sep date", cell: (r) => <span className="text-sm">{dateShort(r.separationDate)}</span> },
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
        title="Employee Separations"
        subtitle="Exit workflow checklist: interview, asset return, PF, final salary."
        actions={<Button variant="brand" onClick={() => setShowForm(true)}>+ New separation</Button>}
      />

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        loading={loading}
        empty={{
          icon: Icon.clipboard,
          title: "No separations yet",
          description: "Structured exit workflow for departing employees.",
          action: <Button variant="brand" onClick={() => setShowForm(true)}>+ New separation</Button>,
        }}
      />

      <Drawer
        open={showForm}
        onClose={() => setShowForm(false)}
        title="New employee separation"
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
          <FormField label="Separation date" required>
            <input type="date" className="input" value={form.separationDate} onChange={(e) => setForm({ ...form, separationDate: e.target.value })} required />
          </FormField>
          <FormField label="Reason">
            <select className="input" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}>
              <option>Resignation</option><option>Termination</option><option>Retirement</option><option>End of contract</option><option>Other</option>
            </select>
          </FormField>
          <div className="text-xs text-ink-muted">Default 7-task exit checklist will be seeded.</div>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </>
  );
}
