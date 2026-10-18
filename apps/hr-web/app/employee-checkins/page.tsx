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
  type Column,
} from "../../components/ui";

interface Employee {
  id: string;
  employeeCode: string;
  employeeName: string;
}
interface Checkin {
  id: string;
  ts: string;
  logType: string;
  source: string | null;
  employee: { employeeCode: string; employeeName: string };
}

export default function EmployeeCheckinsPage() {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [rows, setRows] = useState<Checkin[]>([]);
  const [form, setForm] = useState({ employeeId: "", ts: "", logType: "IN" as "IN" | "OUT" });
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [es, cs] = await Promise.all([
        api.get<Employee[]>("/employees"),
        api.get<Checkin[]>(`/employee-checkins?date=${date}`),
      ]);
      setEmployees(es);
      setRows(cs);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  useListPageCommands({
    singular: "Employee Checkin",
    plural: "Employee Checkins",
    refresh: load,
  });

  async function punch(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await api.post("/employee-checkins", {
        employeeId: form.employeeId,
        ts: new Date(form.ts || new Date()).toISOString(),
        logType: form.logType,
        source: "web",
      });
      setForm({ ...form, ts: "" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function build() {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const r = await api.post<{ created: number; skipped: number }>(
        "/employee-checkins/build-attendance",
        { date },
      );
      setMsg(`Created ${r.created} attendance row(s), skipped ${r.skipped}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const cols: Column<Checkin>[] = [
    {
      header: "When",
      cell: (r) => (
        <span className="font-mono text-xs">
          {new Date(r.ts).toLocaleTimeString()}
        </span>
      ),
    },
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
      header: "Type",
      cell: (r) => (
        <span
          className={r.logType === "IN" ? "badge-green" : "badge-amber"}
        >
          {r.logType}
        </span>
      ),
    },
    {
      header: "Source",
      cell: (r) => (
        <span className="text-xs text-ink-muted">{r.source ?? "—"}</span>
      ),
    },
  ];

  return (
    <main className="p-8 space-y-6 max-w-4xl">
      <PageHeader
        breadcrumb={[
          { label: "HR & Payroll", href: "/hr" },
          { label: "Employee check-ins" },
        ]}
        title="Employee check-ins"
        subtitle={`${rows.length} punch${rows.length === 1 ? "" : "es"} on ${date}`}
        actions={
          <Button
            variant="primary"
            onClick={build}
            disabled={busy || rows.length === 0}
            type="button"
          >
            Build attendance for {date}
          </Button>
        }
      />

      {error && (
        <Card className="p-4 text-red-700 border-red-200 bg-red-50 text-sm">
          {error}
        </Card>
      )}
      {msg && (
        <Card className="p-3 text-green-800 border-green-200 bg-green-50 text-sm">
          {msg}
        </Card>
      )}

      <Card className="p-4">
        <SectionHeader title="Punch in / out" />
        <form onSubmit={punch} className="grid grid-cols-4 gap-3 items-end">
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
          <FormField label="Timestamp">
            <input
              type="datetime-local"
              className="input"
              value={form.ts}
              onChange={(e) => setForm({ ...form, ts: e.target.value })}
            />
          </FormField>
          <FormField label="Log type">
            <select
              className="input"
              value={form.logType}
              onChange={(e) =>
                setForm({ ...form, logType: e.target.value as "IN" | "OUT" })
              }
            >
              <option value="IN">IN</option>
              <option value="OUT">OUT</option>
            </select>
          </FormField>
          <Button variant="primary" type="submit" disabled={busy}>
            Punch
          </Button>
        </form>
      </Card>

      <div className="flex items-center gap-2">
        <label className="text-xs uppercase tracking-wider text-ink-muted font-medium">
          Show punches for
        </label>
        <input
          type="date"
          className="input py-1 max-w-[180px]"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </div>

      <DataTable<Checkin>
        columns={cols}
        rows={rows}
        rowKey={(r) => r.id}
        empty={{ title: `No punches for ${date}` }}
      />
    </main>
  );
}
