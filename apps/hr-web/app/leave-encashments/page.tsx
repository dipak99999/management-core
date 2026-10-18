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
interface LeaveType { id: string; leaveTypeName: string; isEncashable: boolean }
interface Enc {
  id: string;
  name: string;
  encashmentDate: string;
  days: string;
  dailyRate: string;
  amount: string;
  status: string;
  modeOfPayment: string;
  employee: { employeeCode: string; employeeName: string };
  leaveType: { leaveTypeName: string };
}

export default function LeaveEncashmentsPage() {
  const [rows, setRows] = useState<Enc[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [form, setForm] = useState({
    employeeId: "",
    leaveTypeId: "",
    encashmentDate: new Date().toISOString().slice(0, 10),
    days: "",
    dailyRate: "",
    modeOfPayment: "Bank" as "Bank" | "Cash",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const [rs, es, lts] = await Promise.all([
        api.get<Enc[]>("/leave-encashments"),
        api.get<Employee[]>("/employees"),
        api.get<LeaveType[]>("/leave-types"),
      ]);
      setRows(rs);
      setEmployees(es);
      setLeaveTypes(lts.filter((l) => l.isEncashable));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => {
    load();
  }, []);

  useListPageCommands({
    singular: "Leave Encashment",
    plural: "Leave Encashments",
    refresh: load,
  });

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/leave-encashments", {
        employeeId: form.employeeId,
        leaveTypeId: form.leaveTypeId,
        encashmentDate: new Date(form.encashmentDate).toISOString(),
        days: Number(form.days),
        dailyRate: form.dailyRate ? Number(form.dailyRate) : undefined,
        modeOfPayment: form.modeOfPayment,
      });
      setForm({ ...form, days: "", dailyRate: "" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function act(id: string, path: string, confirmMsg?: string) {
    if (confirmMsg && !confirm(confirmMsg)) return;
    setBusy(true);
    try {
      await api.post(`/leave-encashments/${id}/${path}`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const cols: Column<Enc>[] = [
    { header: "Name", cell: (r) => <span className="font-mono">{r.name}</span> },
    { header: "Date", cell: (r) => dateShort(r.encashmentDate) },
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
      header: "Leave",
      cell: (r) => <span className="text-xs">{r.leaveType.leaveTypeName}</span>,
    },
    {
      header: "Days",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums">{Number(r.days).toFixed(2)}</span>
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
      cell: (r) => (
        <div className="flex gap-2 justify-end text-xs">
          {r.status === "Draft" && (
            <button
              onClick={() => act(r.id, "approve")}
              className="text-brand-600 hover:underline"
            >
              Approve
            </button>
          )}
          {r.status === "Approved" && (
            <button
              onClick={() => act(r.id, "pay", "Pay out encashment? Will post GL.")}
              className="text-brand-600 hover:underline"
            >
              Pay
            </button>
          )}
          {r.status !== "Cancelled" && (
            <button
              onClick={() => act(r.id, "cancel", "Cancel encashment?")}
              className="text-red-600 hover:underline"
            >
              Cancel
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <main className="p-8 space-y-6 max-w-6xl">
      <PageHeader
        breadcrumb={[
          { label: "HR & Payroll", href: "/hr" },
          { label: "Leave encashments" },
        ]}
        title="Leave encashments"
        subtitle={`${rows.length} encashment${rows.length === 1 ? "" : "s"}`}
      />

      {error && (
        <Card className="p-4 text-red-700 border-red-200 bg-red-50 text-sm">
          {error}
        </Card>
      )}

      <Card className="p-4">
        <SectionHeader title="New encashment" />
        <form
          onSubmit={create}
          className="grid grid-cols-6 gap-3 items-end"
        >
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
          <FormField label="Leave type" required>
            <select
              className="input"
              value={form.leaveTypeId}
              onChange={(e) => setForm({ ...form, leaveTypeId: e.target.value })}
              required
            >
              <option value="">Choose…</option>
              {leaveTypes.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.leaveTypeName}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Date">
            <input
              type="date"
              className="input"
              value={form.encashmentDate}
              onChange={(e) =>
                setForm({ ...form, encashmentDate: e.target.value })
              }
            />
          </FormField>
          <FormField label="Mode">
            <select
              className="input"
              value={form.modeOfPayment}
              onChange={(e) =>
                setForm({
                  ...form,
                  modeOfPayment: e.target.value as "Bank" | "Cash",
                })
              }
            >
              <option>Bank</option>
              <option>Cash</option>
            </select>
          </FormField>
          <FormField label="Days" required>
            <input
              type="number"
              step="0.5"
              className="input"
              value={form.days}
              onChange={(e) => setForm({ ...form, days: e.target.value })}
              required
            />
          </FormField>
          <FormField label="Daily rate (opt)">
            <input
              type="number"
              step="0.01"
              className="input"
              value={form.dailyRate}
              onChange={(e) => setForm({ ...form, dailyRate: e.target.value })}
            />
          </FormField>
          <div className="col-span-6 flex justify-end">
            <Button variant="primary" type="submit" disabled={busy}>
              + Draft encashment
            </Button>
          </div>
        </form>
      </Card>

      <DataTable<Enc>
        columns={cols}
        rows={rows}
        rowKey={(r) => r.id}
        empty={{ title: "No encashments yet" }}
      />
    </main>
  );
}
