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
  dateShort,
  type Column,
} from "../../components/ui";

interface Employee {
  id: string;
  employeeCode: string;
  employeeName: string;
}
interface LeaveType {
  id: string;
  leaveTypeName: string;
  color: string | null;
}
interface Allocation {
  id: string;
  fromDate: string;
  toDate: string;
  totalLeaves: string;
  notes: string | null;
  employee: Employee;
  leaveType: LeaveType;
}

const emptyForm = {
  employeeId: "",
  leaveTypeId: "",
  fromDate: "",
  toDate: "",
  totalLeaves: 0,
  notes: "",
};

export default function LeaveAllocationsPage() {
  const [rows, setRows] = useState<Allocation[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [as, es, ts] = await Promise.all([
        api.get<Allocation[]>("/leave-allocations"),
        api.get<Employee[]>("/employees"),
        api.get<LeaveType[]>("/leave-types"),
      ]);
      setRows(as);
      setEmployees(es);
      setTypes(ts);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => {
    load();
  }, []);

  useListPageCommands({
    singular: "Leave Allocation",
    plural: "Leave Allocations",
    refresh: load,
  });

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await api.post("/leave-allocations", {
        ...form,
        fromDate: new Date(form.fromDate).toISOString(),
        toDate: new Date(form.toDate).toISOString(),
      });
      setForm(emptyForm);
      setShowForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const cols: Column<Allocation>[] = [
    {
      header: "Employee",
      cell: (a) => (
        <span>
          {a.employee.employeeName}{" "}
          <span className="text-xs text-ink-muted font-mono">
            {a.employee.employeeCode}
          </span>
        </span>
      ),
    },
    {
      header: "Type",
      cell: (a) =>
        a.leaveType.color ? (
          <span className={`px-2 py-0.5 rounded text-xs ${a.leaveType.color}`}>
            {a.leaveType.leaveTypeName}
          </span>
        ) : (
          <span className="text-xs">{a.leaveType.leaveTypeName}</span>
        ),
    },
    {
      header: "Range",
      cell: (a) => (
        <span className="text-ink-soft">
          {dateShort(a.fromDate)} → {dateShort(a.toDate)}
        </span>
      ),
    },
    {
      header: "Days",
      align: "right",
      cell: (a) => (
        <span className="tabular-nums font-mono">{Number(a.totalLeaves)}</span>
      ),
    },
    {
      header: "Notes",
      cell: (a) => <span className="text-xs text-ink-muted">{a.notes ?? "—"}</span>,
    },
  ];

  return (
    <main className="p-8 space-y-6 max-w-6xl">
      <PageHeader
        breadcrumb={[
          { label: "HR & Payroll", href: "/hr" },
          { label: "Leave allocations" },
        ]}
        title="Leave allocations"
        subtitle="Grant employees N days of a specific leave type over a date range."
        actions={
          <Button
            variant="primary"
            onClick={() => setShowForm((s) => !s)}
            type="button"
          >
            {showForm ? "Cancel" : "+ New allocation"}
          </Button>
        }
      />

      {error && (
        <Card className="p-4 text-red-700 border-red-200 bg-red-50 text-sm">
          {error}
        </Card>
      )}

      {showForm && (
        <Card className="p-4 max-w-2xl">
          <SectionHeader title="New leave allocation" />
          <form onSubmit={create} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Employee" required>
                <select
                  required
                  className="input"
                  value={form.employeeId}
                  onChange={(e) =>
                    setForm({ ...form, employeeId: e.target.value })
                  }
                >
                  <option value="">Choose…</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.employeeName} ({emp.employeeCode})
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Leave type" required>
                <select
                  required
                  className="input"
                  value={form.leaveTypeId}
                  onChange={(e) =>
                    setForm({ ...form, leaveTypeId: e.target.value })
                  }
                >
                  <option value="">Choose…</option>
                  {types.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.leaveTypeName}
                    </option>
                  ))}
                </select>
              </FormField>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <FormField label="From" required>
                <input
                  type="date"
                  required
                  className="input"
                  value={form.fromDate}
                  onChange={(e) => setForm({ ...form, fromDate: e.target.value })}
                />
              </FormField>
              <FormField label="To" required>
                <input
                  type="date"
                  required
                  className="input"
                  value={form.toDate}
                  onChange={(e) => setForm({ ...form, toDate: e.target.value })}
                />
              </FormField>
              <FormField label="Days" required>
                <input
                  type="number"
                  step="0.5"
                  min={0.5}
                  required
                  className="input"
                  value={form.totalLeaves}
                  onChange={(e) =>
                    setForm({ ...form, totalLeaves: Number(e.target.value) })
                  }
                />
              </FormField>
            </div>
            <FormField label="Notes (optional)">
              <input
                className="input"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </FormField>
            <div className="flex justify-end">
              <Button variant="primary" type="submit" disabled={busy}>
                {busy ? "Saving…" : "Save"}
              </Button>
            </div>
          </form>
        </Card>
      )}

      <DataTable<Allocation>
        columns={cols}
        rows={rows}
        rowKey={(a) => a.id}
        empty={{ title: "No allocations yet" }}
      />
    </main>
  );
}
