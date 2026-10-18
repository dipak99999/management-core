"use client";

import { useEffect, useMemo, useState } from "react";
import { useListPageCommands,
  useOptionalUIBackends,
  useSmartDefaults, SavedViewsControls, useRealtimeList } from "@lumaara/web-ui";
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

interface Employee { id: string; employeeCode: string; employeeName: string }
interface Attendance {
  id: string;
  date: string;
  status: string;
  remarks: string | null;
  employee: { employeeCode: string; employeeName: string };
}

const STATUSES = ["Present", "Absent", "Half Day", "On Leave", "Work From Home"] as const;
type StatusFilter = "all" | (typeof STATUSES)[number];

export default function AttendancePage() {
  const [rows, setRows] = useState<Attendance[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("Present");
  const [remarks, setRemarks] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  async function load() {
    setLoading(true);
    try {
      setRows(await api.get<Attendance[]>("/attendance"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    api.get<Employee[]>("/employees").then(setEmployees).catch(() => {});
  }, []);

  useListPageCommands({
    singular: "Attendance",
    plural: "Attendance",
    refresh: load,
  });
  useRealtimeList("attendance", load);

  // Smart defaults: the most common attendance workflow is marking the
  // same team repeatedly over a shift — pre-fill the last employee and
  // status so marking the next person is one click.
  const uiBackends = useOptionalUIBackends();
  const smart = useSmartDefaults<{ employeeId: string; status: (typeof STATUSES)[number] }>(
    "hr-web:attendance-mark",
    uiBackends?.defaults,
  );
  useEffect(() => {
    if (!showForm) return;
    if (employeeId || !smart.last) return;
    if (smart.last.employeeId) setEmployeeId(smart.last.employeeId);
    if (smart.last.status) setStatus(smart.last.status);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showForm, smart.last?.employeeId, smart.last?.status]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/attendance", { employeeId, date, status, remarks });
      smart.remember({ employeeId, status });
      setRemarks("");
      setShowForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (q && !`${r.employee.employeeCode} ${r.employee.employeeName} ${r.remarks ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, search, statusFilter]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length };
    for (const s of STATUSES) c[s] = rows.filter((r) => r.status === s).length;
    return c;
  }, [rows]);

  const columns: Column<Attendance>[] = [
    { header: "Date", cell: (r) => <span className="text-ink-soft">{dateShort(r.date)}</span> },
    {
      header: "Employee",
      cell: (r) => (
        <div>
          <div className="font-medium text-ink">{r.employee.employeeName}</div>
          <div className="text-xs text-ink-muted font-mono">{r.employee.employeeCode}</div>
        </div>
      ),
    },
    { header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
    { header: "Remarks", cell: (r) => <span className="text-ink-soft">{r.remarks ?? "—"}</span> },
  ];

  return (
    <>
      <PageHeader
        title="Attendance"
        subtitle={`${rows.length} record${rows.length === 1 ? "" : "s"}`}
        actions={<Button variant="brand" onClick={() => setShowForm(true)}>+ Mark attendance</Button>}
      />

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}

      <div className="space-y-4">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search employee or remarks…" }}
          filters={
            <Segmented
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: "all", label: "All", count: counts.all },
                ...STATUSES.map((s) => ({ value: s, label: s, count: counts[s] })),
              ]}
        />
          }
          actions={<SavedViewsControls listKey="hr-web:attendance" current={{ search, statusFilter }} onApply={(fv) => { setSearch(fv.search); setStatusFilter(fv.statusFilter); }} />}
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.id}
          loading={loading}
          empty={{
            icon: Icon.calendar,
            title: search || statusFilter !== "all" ? "No matching records" : "No attendance yet",
            description: search || statusFilter !== "all"
              ? "Try changing your search or filter."
              : "Mark attendance to start tracking presence.",
            action: !search && statusFilter === "all" && (
              <Button variant="brand" onClick={() => setShowForm(true)}>+ Mark attendance</Button>
            ),
          }}
        />
      </div>

      <Drawer
        open={showForm}
        onClose={() => setShowForm(false)}
        title="Mark attendance"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button variant="brand" onClick={(e) => submit(e as unknown as React.FormEvent)}>Mark</Button>
          </>
        }
      >
        <form onSubmit={submit} className="space-y-4">
          <FormField label="Employee" required>
            <select
              required
              className="input"
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
            >
              <option value="">Select…</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>{emp.employeeCode} — {emp.employeeName}</option>
              ))}
            </select>
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Date" required>
              <input
                required
                type="date"
                className="input"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </FormField>
            <FormField label="Status">
              <select
                className="input"
                value={status}
                onChange={(e) => setStatus(e.target.value as (typeof STATUSES)[number])}
              >
                {STATUSES.map((s) => (<option key={s}>{s}</option>))}
              </select>
            </FormField>
          </div>
          <FormField label="Remarks">
            <input
              className="input"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
            />
          </FormField>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </>
  );
}
