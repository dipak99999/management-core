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
  dateShort,
  money,
  type Column,
} from "../../components/ui";

interface Employee { id: string; employeeCode: string; employeeName: string }
interface OT {
  id: string;
  name: string;
  otDate: string;
  hours: string;
  hourlyRate: string;
  amount: string;
  status: string;
  reason: string | null;
  employee: { employeeCode: string; employeeName: string };
}

export default function OvertimePage() {
  const [rows, setRows] = useState<OT[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [form, setForm] = useState({
    employeeId: "",
    otDate: new Date().toISOString().slice(0, 10),
    hours: "",
    hourlyRate: "",
    reason: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [rs, es] = await Promise.all([
        api.get<OT[]>("/overtime-requests"),
        api.get<Employee[]>("/employees"),
      ]);
      setRows(rs);
      setEmployees(es);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => {
    load();
  }, []);

  useListPageCommands({
    singular: "Overtime Request",
    plural: "Overtime Requests",
    refresh: load,
  });

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/overtime-requests", {
        employeeId: form.employeeId,
        otDate: new Date(form.otDate).toISOString(),
        hours: Number(form.hours),
        hourlyRate: Number(form.hourlyRate),
        reason: form.reason || null,
      });
      setForm({ ...form, hours: "", hourlyRate: "", reason: "" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function act(id: string, path: string) {
    setBusy(true);
    try {
      await api.post(`/overtime-requests/${id}/${path}`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const cols: Column<OT>[] = [
    { header: "Name", cell: (r) => <span className="font-mono">{r.name}</span> },
    { header: "Date", cell: (r) => dateShort(r.otDate) },
    {
      header: "Employee",
      cell: (r) => (
        <div>
          <div className="text-xs font-mono text-ink-muted">
            {r.employee.employeeCode}
          </div>
          <div>{r.employee.employeeName}</div>
        </div>
      ),
    },
    {
      header: "Hours",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums">{Number(r.hours).toFixed(2)}</span>
      ),
    },
    {
      header: "Rate",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums">{money(Number(r.hourlyRate))}</span>
      ),
    },
    {
      header: "Amount",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums font-medium">
          {money(Number(r.amount))}
        </span>
      ),
    },
    { header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
    {
      header: "",
      align: "right",
      cell: (r) =>
        r.status === "Draft" ? (
          <div className="flex gap-2 justify-end text-xs">
            <button
              onClick={() => act(r.id, "approve")}
              className="text-brand-600 hover:underline"
            >
              Approve
            </button>
            <button
              onClick={() => act(r.id, "reject")}
              className="text-red-600 hover:underline"
            >
              Reject
            </button>
          </div>
        ) : null,
    },
  ];

  return (
    <main className="p-8 space-y-6 max-w-6xl">
      <PageHeader
        breadcrumb={[
          { label: "HR & Payroll", href: "/hr" },
          { label: "Overtime requests" },
        ]}
        title="Overtime requests"
        subtitle={`${rows.length} request${rows.length === 1 ? "" : "s"}`}
      />

      {error && (
        <Card className="p-4 text-red-700 border-red-200 bg-red-50 text-sm">
          {error}
        </Card>
      )}

      <Card className="p-4">
        <SectionHeader title="New request" />
        <form onSubmit={create} className="grid grid-cols-5 gap-3 items-end">
          <FormField label="Employee" required>
            <select
              className="input"
              value={form.employeeId}
              onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
              required
            >
              <option value="">Choose…</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.employeeCode} — {e.employeeName}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Date">
            <input
              type="date"
              className="input"
              value={form.otDate}
              onChange={(e) => setForm({ ...form, otDate: e.target.value })}
            />
          </FormField>
          <FormField label="Hours" required>
            <input
              type="number"
              step="0.25"
              className="input"
              value={form.hours}
              onChange={(e) => setForm({ ...form, hours: e.target.value })}
              required
            />
          </FormField>
          <FormField label="Rate/hr" required>
            <input
              type="number"
              step="0.01"
              className="input"
              value={form.hourlyRate}
              onChange={(e) => setForm({ ...form, hourlyRate: e.target.value })}
              required
            />
          </FormField>
          <Button variant="primary" type="submit" disabled={busy}>
            + Request
          </Button>
        </form>
      </Card>

      <DataTable<OT>
        columns={cols}
        rows={rows}
        rowKey={(r) => r.id}
        empty={{ title: "No overtime requests yet" }}
      />
    </main>
  );
}
