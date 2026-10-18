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
  type Column,
} from "../../components/ui";

interface Employee { id: string; employeeCode: string; employeeName: string }
interface AR {
  id: string;
  name: string;
  attendanceDate: string;
  requestedStatus: string;
  requestedCheckIn: string | null;
  requestedCheckOut: string | null;
  reason: string;
  status: string;
  employee: { employeeCode: string; employeeName: string };
}

export default function AttendanceRegularizationsPage() {
  const [rows, setRows] = useState<AR[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [form, setForm] = useState({
    employeeId: "",
    attendanceDate: new Date().toISOString().slice(0, 10),
    requestedStatus: "Present",
    requestedCheckIn: "",
    requestedCheckOut: "",
    reason: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [rs, es] = await Promise.all([
        api.get<AR[]>("/attendance-regularizations"),
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
    singular: "Attendance Regularization",
    plural: "Attendance Regularizations",
    refresh: load,
  });

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/attendance-regularizations", {
        employeeId: form.employeeId,
        attendanceDate: new Date(form.attendanceDate).toISOString(),
        requestedStatus: form.requestedStatus,
        requestedCheckIn: form.requestedCheckIn
          ? new Date(`${form.attendanceDate}T${form.requestedCheckIn}:00`).toISOString()
          : null,
        requestedCheckOut: form.requestedCheckOut
          ? new Date(`${form.attendanceDate}T${form.requestedCheckOut}:00`).toISOString()
          : null,
        reason: form.reason,
      });
      setForm({ ...form, requestedCheckIn: "", requestedCheckOut: "", reason: "" });
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
      await api.post(`/attendance-regularizations/${id}/${path}`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const cols: Column<AR>[] = [
    { header: "Name", cell: (r) => <span className="font-mono">{r.name}</span> },
    { header: "Date", cell: (r) => dateShort(r.attendanceDate) },
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
      header: "Requested",
      cell: (r) => (
        <div className="text-xs">
          <div>{r.requestedStatus}</div>
          {r.requestedCheckIn && (
            <div className="text-ink-muted">
              {new Date(r.requestedCheckIn).toLocaleTimeString()} →{" "}
              {r.requestedCheckOut
                ? new Date(r.requestedCheckOut).toLocaleTimeString()
                : "—"}
            </div>
          )}
        </div>
      ),
    },
    { header: "Reason", cell: (r) => <span className="text-xs">{r.reason}</span> },
    { header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
    {
      header: "",
      align: "right",
      cell: (r) =>
        r.status === "Draft" ? (
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => act(r.id, "approve")}
              className="text-brand-600 text-xs hover:underline"
            >
              Approve
            </button>
            <button
              onClick={() => act(r.id, "reject")}
              className="text-red-600 text-xs hover:underline"
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
          { label: "Attendance regularizations" },
        ]}
        title="Attendance regularizations"
        subtitle={`${rows.length} request${rows.length === 1 ? "" : "s"}`}
      />

      {error && (
        <Card className="p-4 text-red-700 border-red-200 bg-red-50 text-sm">
          {error}
        </Card>
      )}

      <Card className="p-4">
        <SectionHeader title="New request" />
        <form onSubmit={create} className="space-y-3">
          <div className="grid grid-cols-4 gap-3">
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
                value={form.attendanceDate}
                onChange={(e) =>
                  setForm({ ...form, attendanceDate: e.target.value })
                }
              />
            </FormField>
            <FormField label="Requested status">
              <select
                className="input"
                value={form.requestedStatus}
                onChange={(e) =>
                  setForm({ ...form, requestedStatus: e.target.value })
                }
              >
                <option>Present</option>
                <option>Absent</option>
                <option>Half Day</option>
                <option>Work From Home</option>
              </select>
            </FormField>
            <div className="grid grid-cols-2 gap-2">
              <FormField label="Check-in">
                <input
                  type="time"
                  className="input"
                  value={form.requestedCheckIn}
                  onChange={(e) =>
                    setForm({ ...form, requestedCheckIn: e.target.value })
                  }
                />
              </FormField>
              <FormField label="Check-out">
                <input
                  type="time"
                  className="input"
                  value={form.requestedCheckOut}
                  onChange={(e) =>
                    setForm({ ...form, requestedCheckOut: e.target.value })
                  }
                />
              </FormField>
            </div>
          </div>
          <FormField label="Reason" required>
            <input
              className="input"
              placeholder="Why is regularization needed?"
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              required
            />
          </FormField>
          <div className="flex justify-end">
            <Button variant="primary" type="submit" disabled={busy}>
              + Request regularization
            </Button>
          </div>
        </form>
      </Card>

      <DataTable<AR>
        columns={cols}
        rows={rows}
        rowKey={(r) => r.id}
        empty={{ title: "No regularization requests" }}
      />
    </main>
  );
}
