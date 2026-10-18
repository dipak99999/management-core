"use client";

import { useEffect, useState } from "react";
import { useListPageCommands } from "@lumaara/web-ui";
import { api } from "../../lib/api";
import {
  Button,
  Card,
  DataTable,
  FormField,
  PageHeader,
  SectionHeader,
  StatusBadge,
  type Column,
} from "../../components/ui";

interface Employee { id: string; employeeCode: string; employeeName: string }
interface Hierarchy {
  id: string;
  level: number;
  scope: string;
  isActive: boolean;
  employee: Employee;
  approver: Employee;
}

export default function ApproverHierarchiesPage() {
  const [rows, setRows] = useState<Hierarchy[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [form, setForm] = useState({
    employeeId: "",
    approverEmployeeId: "",
    level: 1,
    scope: "Leave" as "Leave" | "Expense" | "Timesheet" | "*",
    isActive: true,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    try {
      const [h, e] = await Promise.all([
        api.get<Hierarchy[]>("/approver-hierarchies"),
        api.get<Employee[]>("/employees"),
      ]);
      setRows(h);
      setEmployees(e);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => {
    load();
  }, []);

  useListPageCommands({
    singular: "Approver Hierarchy",
    plural: "Approver Hierarchies",
    refresh: load,
  });

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.post("/approver-hierarchies", form);
      setForm({ ...form, employeeId: "", approverEmployeeId: "" });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Remove this approver link?")) return;
    try {
      await api.del(`/approver-hierarchies/${id}`);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    }
  }

  const columns: Column<Hierarchy>[] = [
    {
      header: "Employee",
      cell: (r) => `${r.employee.employeeCode} · ${r.employee.employeeName}`,
    },
    {
      header: "Approver",
      cell: (r) => `${r.approver.employeeCode} · ${r.approver.employeeName}`,
    },
    { header: "Level", align: "right", cell: (r) => `L${r.level}` },
    { header: "Scope", cell: (r) => r.scope },
    {
      header: "Status",
      cell: (r) => <StatusBadge status={r.isActive ? "Active" : "Disabled"} />,
    },
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
        breadcrumb={[{ label: "HR", href: "/" }, { label: "Approver Hierarchies" }]}
        title="Approver Hierarchies"
        subtitle="Employee → approver graph · powers the 'Leave Approval Hierarchy' dashboard"
      />
      {err && <div className="mb-4 p-3 rounded bg-red-50 border border-red-200 text-red-800 text-sm">{err}</div>}
      <Card className="p-4 mb-4">
        <SectionHeader title="New approver link" />
        <form onSubmit={create} className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <FormField label="Employee" required>
            <select className="input" required value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })}>
              <option value="">—</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.employeeCode} · {e.employeeName}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Approver" required>
            <select
              className="input"
              required
              value={form.approverEmployeeId}
              onChange={(e) => setForm({ ...form, approverEmployeeId: e.target.value })}
            >
              <option value="">—</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.employeeCode} · {e.employeeName}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Level">
            <input type="number" min={1} max={10} className="input" value={form.level} onChange={(e) => setForm({ ...form, level: Number(e.target.value) || 1 })} />
          </FormField>
          <FormField label="Scope">
            <select
              className="input"
              value={form.scope}
              onChange={(e) => setForm({ ...form, scope: e.target.value as typeof form.scope })}
            >
              <option value="Leave">Leave</option>
              <option value="Expense">Expense</option>
              <option value="Timesheet">Timesheet</option>
              <option value="*">All</option>
            </select>
          </FormField>
          <div className="flex items-end">
            <Button variant="brand" type="submit" disabled={busy} className="w-full">
              {busy ? "Saving…" : "Link"}
            </Button>
          </div>
        </form>
      </Card>
      <Card className="p-0 overflow-hidden">
        <DataTable rows={rows} columns={columns} rowKey={(r) => r.id} empty={{ title: "No approver links yet." }} />
      </Card>
    </>
  );
}
