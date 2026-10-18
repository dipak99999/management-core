"use client";

import { useEffect, useMemo, useState } from "react";
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
interface LeaveType { id: string; leaveTypeName: string; color: string | null }
interface WorkGroup { id: string; name: string }
interface EmployeeCategory { id: string; name: string }

interface LedgerRow {
  id: string;
  postingDate: string;
  entryType: string;
  leaves: string;
  balanceAfter: string;
  fromDate: string | null;
  toDate: string | null;
  workGroupId: string | null;
  employeeCategoryId: string | null;
  isCarryForward: boolean;
  isExpired: boolean;
  isEncashment: boolean;
  sourceDoctype: string | null;
  sourceDocId: string | null;
  reason: string | null;
  createdBy: string | null;
  createdAt: string;
  employee: { id: string; employeeCode: string; employeeName: string };
  leaveType: { id: string; leaveTypeName: string; color: string | null };
}

interface BalanceRow {
  leaveType: { id: string; leaveTypeName: string; color: string | null };
  balance: number;
  lastEntryAt: string;
}

const ENTRY_TYPES = ["Opening", "Allocation", "Consumption", "Adjustment", "Encashment", "Expiry", "CarryForward"] as const;

export default function LeaveLedgerPage() {
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [workGroups, setWorkGroups] = useState<WorkGroup[]>([]);
  const [categories, setCategories] = useState<EmployeeCategory[]>([]);
  const [balance, setBalance] = useState<BalanceRow[]>([]);

  const [filters, setFilters] = useState({
    employeeId: "",
    leaveTypeId: "",
    entryType: "",
    workGroupId: "",
    employeeCategoryId: "",
    from: "",
    to: "",
  });

  const [adjustment, setAdjustment] = useState({
    employeeId: "",
    leaveTypeId: "",
    postingDate: new Date().toISOString().slice(0, 10),
    leaves: "",
    entryType: "Adjustment" as (typeof ENTRY_TYPES)[number],
    reason: "",
  });

  const [busy, setBusy] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function loadMasters() {
    try {
      const [es, lts, wgs, ecs] = await Promise.all([
        api.get<Employee[]>("/employees"),
        api.get<LeaveType[]>("/leave-types"),
        api.get<WorkGroup[]>("/work-groups"),
        api.get<EmployeeCategory[]>("/employee-categories"),
      ]);
      setEmployees(es);
      setLeaveTypes(lts);
      setWorkGroups(wgs);
      setCategories(ecs);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load masters");
    }
  }

  async function loadRows() {
    try {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(filters)) if (v) qs.set(k, v);
      const r = await api.get<LedgerRow[]>(`/leave-ledger${qs.toString() ? `?${qs}` : ""}`);
      setRows(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load ledger");
    }
  }

  async function loadBalance(employeeId: string) {
    if (!employeeId) {
      setBalance([]);
      return;
    }
    try {
      const b = await api.get<BalanceRow[]>(`/leave-ledger/balance/${employeeId}`);
      setBalance(b);
    } catch {
      setBalance([]);
    }
  }

  useEffect(() => {
    loadMasters();
    loadRows();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadBalance(filters.employeeId);
  }, [filters.employeeId]);

  async function applyFilters() {
    await loadRows();
  }

  async function submitAdjustment(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      await api.post("/leave-ledger", {
        ...adjustment,
        postingDate: new Date(adjustment.postingDate).toISOString(),
        leaves: Number(adjustment.leaves),
      });
      setAdjustment({ ...adjustment, leaves: "", reason: "" });
      setMsg("Adjustment recorded");
      await loadRows();
      if (adjustment.employeeId) await loadBalance(adjustment.employeeId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function runBackfill() {
    if (!confirm("Rebuild ledger from allocations, approved applications, and encashments? Manual adjustments are preserved.")) return;
    setBackfilling(true);
    setErr(null);
    setMsg(null);
    try {
      const r = await api.post<{ scanned: Record<string, number>; inserted: number }>("/leave-ledger/backfill", {});
      setMsg(`Backfill complete: ${r.inserted} rows inserted from ${r.scanned.allocations} allocations + ${r.scanned.applications} approved apps + ${r.scanned.encashments} encashments`);
      await loadRows();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Backfill failed");
    } finally {
      setBackfilling(false);
    }
  }

  async function seedAnalytics() {
    if (!confirm("Seed the 11 Leave dashboards + Leave Ledger saved report? Existing ones with the same names will be rebuilt.")) return;
    setSeeding(true);
    setErr(null);
    setMsg(null);
    try {
      const r = await api.post<{ dashboards: Array<{ name: string; cards: number }>; report: { id: string; created: boolean } }>("/leave-ledger/seed-analytics", {});
      setMsg(`Seeded: ${r.dashboards.length} dashboards (${r.dashboards.reduce((s, d) => s + d.cards, 0)} charts) + Leave Ledger saved report`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Seed failed");
    } finally {
      setSeeding(false);
    }
  }

  const columns: Column<LedgerRow>[] = useMemo(
    () => [
      { header: "Posted", cell: (r) => dateShort(r.postingDate) },
      {
        header: "Employee",
        cell: (r) => `${r.employee.employeeCode} · ${r.employee.employeeName}`,
      },
      { header: "Type", cell: (r) => r.leaveType.leaveTypeName },
      {
        header: "Entry",
        cell: (r) => <StatusBadge status={r.entryType} />,
      },
      {
        header: "Leaves",
        align: "right",
        cell: (r) => {
          const n = Number(r.leaves);
          return <span className={n >= 0 ? "text-emerald-700 tabular-nums" : "text-red-600 tabular-nums"}>{n >= 0 ? `+${n.toFixed(2)}` : n.toFixed(2)}</span>;
        },
      },
      { header: "Balance", align: "right", cell: (r) => Number(r.balanceAfter).toFixed(2) },
      { header: "From", cell: (r) => (r.fromDate ? dateShort(r.fromDate) : "—") },
      { header: "To", cell: (r) => (r.toDate ? dateShort(r.toDate) : "—") },
      { header: "Reason", cell: (r) => r.reason ?? "—" },
      {
        header: "Source",
        cell: (r) => (r.sourceDoctype ? `${r.sourceDoctype}${r.sourceDocId ? `#${r.sourceDocId.slice(0, 6)}` : ""}` : "Manual"),
      },
    ],
    [],
  );

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "HR", href: "/" }, { label: "Leave Ledger" }]}
        title="Leave Ledger for Employee"
       
        actions={
          <>
            <Button variant="secondary" onClick={runBackfill} disabled={backfilling} type="button">
              {backfilling ? "Rebuilding…" : "Rebuild from source"}
            </Button>
            <Button variant="brand" onClick={seedAnalytics} disabled={seeding} type="button">
              {seeding ? "Seeding…" : "Seed 11 dashboards"}
            </Button>
          </>
        }
      />

      {msg && (
        <div className="mb-4 p-3 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm">{msg}</div>
      )}
      {err && (
        <div className="mb-4 p-3 rounded bg-red-50 border border-red-200 text-red-800 text-sm">{err}</div>
      )}

      <div className="grid grid-cols-12 gap-4">
        {/* Filters */}
        <Card className="col-span-12 lg:col-span-8 p-4">
          <SectionHeader title="Filters" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <FormField label="Employee">
              <select
                className="input"
                value={filters.employeeId}
                onChange={(e) => setFilters({ ...filters, employeeId: e.target.value })}
              >
                <option value="">All</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.employeeCode} · {e.employeeName}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Leave type">
              <select
                className="input"
                value={filters.leaveTypeId}
                onChange={(e) => setFilters({ ...filters, leaveTypeId: e.target.value })}
              >
                <option value="">All</option>
                {leaveTypes.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.leaveTypeName}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Entry type">
              <select
                className="input"
                value={filters.entryType}
                onChange={(e) => setFilters({ ...filters, entryType: e.target.value })}
              >
                <option value="">All</option>
                {ENTRY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Work group">
              <select
                className="input"
                value={filters.workGroupId}
                onChange={(e) => setFilters({ ...filters, workGroupId: e.target.value })}
              >
                <option value="">All</option>
                {workGroups.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Category">
              <select
                className="input"
                value={filters.employeeCategoryId}
                onChange={(e) => setFilters({ ...filters, employeeCategoryId: e.target.value })}
              >
                <option value="">All</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="From">
              <input
                type="date"
                className="input"
                value={filters.from}
                onChange={(e) => setFilters({ ...filters, from: e.target.value })}
              />
            </FormField>
            <FormField label="To">
              <input
                type="date"
                className="input"
                value={filters.to}
                onChange={(e) => setFilters({ ...filters, to: e.target.value })}
              />
            </FormField>
            <div className="flex items-end">
              <Button variant="brand" onClick={applyFilters} type="button" className="w-full">
                Apply
              </Button>
            </div>
          </div>
        </Card>

        {/* Balance snapshot */}
        <Card className="col-span-12 lg:col-span-4 p-4">
          <SectionHeader title="Balance snapshot" />
          {!filters.employeeId ? (
            <div className="text-xs text-ink-muted">Select an employee to see their per-type balance.</div>
          ) : balance.length === 0 ? (
            <div className="text-xs text-ink-muted">No ledger entries for this employee yet.</div>
          ) : (
            <div className="space-y-2">
              {balance.map((b) => (
                <div key={b.leaveType.id} className="flex items-center justify-between text-sm">
                  <span className="text-ink">{b.leaveType.leaveTypeName}</span>
                  <span className={`tabular-nums font-semibold ${b.balance >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                    {b.balance.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Manual adjustment */}
        <Card className="col-span-12 p-4">
          <SectionHeader title="Record manual adjustment" />
          <form onSubmit={submitAdjustment} className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <FormField label="Employee" required>
              <select
                className="input"
                required
                value={adjustment.employeeId}
                onChange={(e) => setAdjustment({ ...adjustment, employeeId: e.target.value })}
              >
                <option value="">—</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.employeeCode} · {e.employeeName}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Leave type" required>
              <select
                className="input"
                required
                value={adjustment.leaveTypeId}
                onChange={(e) => setAdjustment({ ...adjustment, leaveTypeId: e.target.value })}
              >
                <option value="">—</option>
                {leaveTypes.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.leaveTypeName}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Entry type" required>
              <select
                className="input"
                value={adjustment.entryType}
                onChange={(e) => setAdjustment({ ...adjustment, entryType: e.target.value as (typeof ENTRY_TYPES)[number] })}
              >
                {(["Opening", "Adjustment", "CarryForward", "Expiry"] as const).map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Posting date" required>
              <input
                type="date"
                className="input"
                required
                value={adjustment.postingDate}
                onChange={(e) => setAdjustment({ ...adjustment, postingDate: e.target.value })}
              />
            </FormField>
            <FormField label="Leaves (± days)" required>
              <input
                type="number"
                step="0.5"
                className="input"
                required
                value={adjustment.leaves}
                onChange={(e) => setAdjustment({ ...adjustment, leaves: e.target.value })}
              />
            </FormField>
            <FormField label="Reason" required>
              <input
                className="input"
                required
                value={adjustment.reason}
                onChange={(e) => setAdjustment({ ...adjustment, reason: e.target.value })}
              />
            </FormField>
            <div className="col-span-2 md:col-span-6 flex justify-end">
              <Button variant="brand" type="submit" disabled={busy}>
                {busy ? "Saving…" : "Record adjustment"}
              </Button>
            </div>
          </form>
        </Card>

        {/* The ledger table */}
        <Card className="col-span-12 p-0 overflow-hidden">
          <div className="p-4 pb-2">
            <SectionHeader title={`Ledger · ${rows.length} entries`} />
          </div>
          <DataTable rows={rows} columns={columns} rowKey={(r) => r.id} empty={{ title: "No ledger entries match the filters. Run 'Rebuild from source' to import from existing allocations." }} />
        </Card>
      </div>
    </>
  );
}
