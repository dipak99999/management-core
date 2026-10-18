"use client";

import { useEffect, useMemo, useState } from "react";
import { useListPageCommands, Tour, type TourStep, useRealtimeList, SavedViewsControls } from "@lumaara/web-ui";
import { api } from "../../lib/api";
import {
  Button,
  Card,
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
import { CalendarView } from "../../components/calendar";

interface Employee { id: string; employeeCode: string; employeeName: string }
interface LeaveType { id: string; leaveTypeName: string; color: string | null }
interface Application {
  id: string;
  fromDate: string;
  toDate: string;
  halfDay: boolean;
  totalLeaveDays: string;
  reason: string | null;
  status: string;
  employee: Employee;
  leaveType: LeaveType;
}
interface BalanceRow {
  leaveType: { id: string; leaveTypeName: string; color: string | null };
  allocated: number;
  used: number;
  available: number;
}
interface Balance {
  employee: Employee;
  asOf: string;
  rows: BalanceRow[];
}

const emptyForm = {
  employeeId: "",
  leaveTypeId: "",
  fromDate: "",
  toDate: "",
  halfDay: false,
  reason: "",
};

type StatusFilter = "all" | "Draft" | "Approved" | "Rejected" | "Cancelled";
type ViewMode = "list" | "calendar";

export default function LeaveApplicationsPage() {
  const [rows, setRows] = useState<Application[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [balances, setBalances] = useState<Record<string, Balance>>({});
  const [selectedBalance, setSelectedBalance] = useState<string>("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [view, setView] = useState<ViewMode>("calendar");

  async function load() {
    setLoading(true);
    try {
      const [apps, es, ts] = await Promise.all([
        api.get<Application[]>("/leave-applications"),
        api.get<Employee[]>("/employees"),
        api.get<LeaveType[]>("/leave-types"),
      ]);
      setRows(apps);
      setEmployees(es);
      setTypes(ts);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  useListPageCommands({
    singular: "Leave Application",
    plural: "Leave Applications",
    refresh: load,
  });
  useRealtimeList("leave-application", load);

  const tourSteps: TourStep[] = [
    { target: "[data-tour=hr-leave-applications-v1-header]", title: "Leave Applications", body: "This is where you manage leave applications. Filter by status, search by name, and drill into any row for details.", placement: "bottom" },
    { target: "[data-tour=hr-leave-applications-v1-new]", title: "Create a new leave application", body: "Click here to add your first leave application. The form captures all the required fields and lets you save as draft or submit immediately.", placement: "bottom" },
    { target: "[data-tour=hr-leave-applications-v1-filter]", title: "Save a filtered view", body: "Narrow down with the filters, then use the Views menu to save and name the filter set so it's one click next time.", placement: "bottom" },
  ];

  async function loadBalance(employeeId: string) {
    if (balances[employeeId]) {
      setSelectedBalance(employeeId);
      return;
    }
    try {
      const bal = await api.get<Balance>(`/leave-applications/balance/${employeeId}`);
      setBalances((b) => ({ ...b, [employeeId]: bal }));
      setSelectedBalance(employeeId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post("/leave-applications", {
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

  async function act(id: string, action: "approve" | "reject" | "cancel") {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/leave-applications/${id}/${action}`, {});
      await load();
      setBalances({});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (q && !`${r.employee.employeeName} ${r.employee.employeeCode} ${r.leaveType.leaveTypeName}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, search, statusFilter]);

  const counts = useMemo(() => ({
    all:       rows.length,
    Draft:     rows.filter((r) => r.status === "Draft").length,
    Approved:  rows.filter((r) => r.status === "Approved").length,
    Rejected:  rows.filter((r) => r.status === "Rejected").length,
    Cancelled: rows.filter((r) => r.status === "Cancelled").length,
  }), [rows]);

  const currentBalance = useMemo(
    () => (selectedBalance ? balances[selectedBalance] : null),
    [selectedBalance, balances],
  );

  const columns: Column<Application>[] = [
    {
      header: "Employee",
      cell: (a) => (
        <button
          onClick={(e) => { e.stopPropagation(); loadBalance(a.employee.id); }}
          className="text-start"
          title="Show balance"
        >
          <div className="font-medium text-brand-600 hover:text-brand-700">{a.employee.employeeName}</div>
          <div className="text-xs text-ink-muted font-mono">{a.employee.employeeCode}</div>
        </button>
      ),
    },
    {
      header: "Type",
      cell: (a) => (
        a.leaveType.color
          ? <span className={`badge ${a.leaveType.color}`}>{a.leaveType.leaveTypeName}</span>
          : <span className="text-ink-soft">{a.leaveType.leaveTypeName}</span>
      ),
    },
    {
      header: "Range",
      cell: (a) => (
        <span className="text-ink-soft">
          {dateShort(a.fromDate)} → {dateShort(a.toDate)}
          {a.halfDay && <span className="text-xs text-ink-muted"> · half day</span>}
        </span>
      ),
    },
    {
      header: "Days",
      align: "right",
      cell: (a) => <span className="tabular-nums text-ink">{Number(a.totalLeaveDays)}</span>,
    },
    { header: "Status", cell: (a) => <StatusBadge status={a.status} /> },
    {
      header: "",
      align: "right",
      cell: (a) => (
        <div className="flex items-center gap-1 justify-end">
          {a.status === "Draft" && (
            <>
              <button onClick={(e) => { e.stopPropagation(); act(a.id, "approve"); }} disabled={busy} className="btn-ghost btn-sm text-green-700">Approve</button>
              <button onClick={(e) => { e.stopPropagation(); act(a.id, "reject"); }} disabled={busy} className="btn-ghost btn-sm text-red-600">Reject</button>
            </>
          )}
          {a.status !== "Cancelled" && (
            <button onClick={(e) => { e.stopPropagation(); act(a.id, "cancel"); }} disabled={busy} className="btn-ghost btn-sm">Cancel</button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <Tour id="hr-web.leave-applications.v1" steps={tourSteps} />
      <div data-tour="hr-leave-applications-v1-header">
      <PageHeader
        title="Leave Applications"
        subtitle={`${rows.length} application${rows.length === 1 ? "" : "s"}`}
        actions={<Button variant="brand" onClick={() => setShowForm(true)}>+ New application</Button>}
      />
      </div>

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}

      <div className="space-y-4">
        <div data-tour="hr-leave-applications-v1-filter">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search employee or leave type…" }}
          filters={
            view === "list" ? (
              <Segmented
                value={statusFilter}
                onChange={setStatusFilter}
                options={[
                  { value: "all",       label: "All",       count: counts.all },
                  { value: "Draft",     label: "Draft",     count: counts.Draft },
                  { value: "Approved",  label: "Approved",  count: counts.Approved },
                  { value: "Rejected",  label: "Rejected",  count: counts.Rejected },
                  { value: "Cancelled", label: "Cancelled", count: counts.Cancelled },
                ]}
              />
            ) : null
          }
          actions={
            <>
              <Segmented<ViewMode>
                value={view}
                onChange={setView}
                options={[
                  { value: "calendar", label: "Calendar" },
                  { value: "list", label: "List" },
                ]}
              />
              <SavedViewsControls
                listKey="hr-web:leave-applications"
                current={{ search, statusFilter }}
                onApply={(fv) => { setSearch(fv.search); setStatusFilter(fv.statusFilter); }}
              />
            </>
          }
        />
        </div>
        {view === "calendar" ? (
          <CalendarView<Application>
            // Only show Approved leaves on the shared calendar — Draft/
            // Rejected are noise for a "who's out this month" view.
            rows={filtered.filter((r) => r.status === "Approved")}
            getStart={(a) => a.fromDate}
            getEnd={(a) => a.toDate}
            rowKey={(a) => a.id}
            chipAccent={() => "bg-violet-500"}
            renderChip={(a) =>
              `${a.employee.employeeName} · ${a.leaveType.leaveTypeName}`
            }
            emptyMessage="No approved leave this month."
          />
        ) : (
          <DataTable
            columns={columns}
            rows={filtered}
            rowKey={(a) => a.id}
            loading={loading}
            empty={{
              icon: Icon.calendar,
              title: search || statusFilter !== "all" ? "No matching applications" : "No applications yet",
              description: search || statusFilter !== "all"
                ? "Try changing your search or filter."
                : "Employees can request time off here.",
              action: !search && statusFilter === "all" && (
                <Button variant="brand" onClick={() => setShowForm(true)}>+ New application</Button>
              ),
            }}
          />
        )}

        {currentBalance && (
          <Card className="p-4">
            <div className="flex items-baseline justify-between mb-2">
              <div>
                <h3 className="font-semibold text-ink">Balance for {currentBalance.employee.employeeName}</h3>
                <div className="text-xs text-ink-muted">As of {dateShort(currentBalance.asOf)}</div>
              </div>
              <button onClick={() => setSelectedBalance("")} className="btn-ghost btn-sm">Close</button>
            </div>
            <DataTable
              columns={[
                {
                  header: "Type",
                  cell: (r: BalanceRow) => (
                    r.leaveType.color
                      ? <span className={`badge ${r.leaveType.color}`}>{r.leaveType.leaveTypeName}</span>
                      : <span className="text-ink-soft">{r.leaveType.leaveTypeName}</span>
                  ),
                },
                { header: "Allocated", align: "right", cell: (r) => <span className="tabular-nums">{r.allocated}</span> },
                { header: "Used",      align: "right", cell: (r) => <span className="tabular-nums">{r.used}</span> },
                {
                  header: "Available",
                  align: "right",
                  cell: (r) => (
                    <span className={`tabular-nums font-medium ${r.available <= 0 ? "text-red-700" : "text-green-700"}`}>
                      {r.available}
                    </span>
                  ),
                },
              ]}
              rows={currentBalance.rows}
              rowKey={(r) => r.leaveType.id}
              empty={{ title: "No allocations for this employee" }}
            />
          </Card>
        )}
      </div>

      <Drawer
        open={showForm}
        onClose={() => { setShowForm(false); setForm(emptyForm); }}
        title="New leave application"
        footer={
          <>
            <Button variant="secondary" onClick={() => { setShowForm(false); setForm(emptyForm); }}>Cancel</Button>
            <Button variant="brand" disabled={busy} onClick={(e) => create(e as unknown as React.FormEvent)}>
              {busy ? "Saving…" : "Save as draft"}
            </Button>
          </>
        }
      >
        <form onSubmit={create} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Employee" required>
              <select
                required
                className="input"
                value={form.employeeId}
                onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
              >
                <option value="">Select…</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>{emp.employeeName} ({emp.employeeCode})</option>
                ))}
              </select>
            </FormField>
            <FormField label="Leave type" required>
              <select
                required
                className="input"
                value={form.leaveTypeId}
                onChange={(e) => setForm({ ...form, leaveTypeId: e.target.value })}
              >
                <option value="">Select…</option>
                {types.map((t) => (
                  <option key={t.id} value={t.id}>{t.leaveTypeName}</option>
                ))}
              </select>
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
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
          </div>
          <label className="flex items-center gap-2 text-sm text-ink-soft">
            <input
              type="checkbox"
              checked={form.halfDay}
              onChange={(e) => setForm({ ...form, halfDay: e.target.checked })}
            />
            Half day (counts as 0.5 regardless of range)
          </label>
          <FormField label="Reason">
            <textarea
              className="input"
              rows={3}
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
            />
          </FormField>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </>
  );
}
