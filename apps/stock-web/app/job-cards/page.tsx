"use client";

import { useEffect, useMemo, useState } from "react";
import { useListPageCommands, SavedViewsControls } from "@lumaara/web-ui";
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
  type Column,
} from "../../components/ui";
import { Icon } from "../../components/app-shell";

interface WorkOrder {
  id: string;
  name: string;
  status: string;
  qty: string;
  producedQty: string;
}
interface WorkOrderOperation {
  id: string;
  operationName: string;
  workstationId: string;
  timeInMins: string;
  hourRate: string;
  completedQty: string;
  actualTimeMins: string;
  status: string;
  workstation: { id: string; name: string };
}
interface JobCard {
  id: string;
  name: string;
  employeeName: string | null;
  startedAt: string | null;
  completedAt: string | null;
  totalTimeMins: string;
  quantity: string;
  status: string;
  remarks: string | null;
  workOrder: { id: string; name: string; status: string };
  operation: { id: string; operationName: string };
  workstation: { id: string; name: string };
}

interface EmployeeLite {
  id: string;
  employeeCode: string;
  employeeName: string;
}
async function loadEmployees(): Promise<EmployeeLite[]> {
  const HR = process.env.NEXT_PUBLIC_HR_SERVICE_URL ?? "/api/hr";
  const raw = localStorage.getItem("lumaara.session");
  const token = raw ? (JSON.parse(raw).token as string) : "";
  const res = await fetch(`${HR}/employees`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to load employees (${res.status})`);
  return res.json();
}

type StatusFilter = "all" | "Open" | "InProgress" | "Paused" | "Completed" | "Cancelled";

const emptyForm = {
  workOrderId: "",
  operationId: "",
  employeeId: "",
  employeeName: "",
  remarks: "",
};

export default function JobCardsPage() {
  const [rows, setRows] = useState<JobCard[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [operations, setOperations] = useState<Record<string, WorkOrderOperation[]>>({});
  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  async function load() {
    setLoading(true);
    try {
      const [jcs, wos] = await Promise.all([
        api.get<JobCard[]>("/job-cards"),
        api.get<WorkOrder[]>("/work-orders"),
      ]);
      setRows(jcs);
      setWorkOrders(wos.filter((w) => w.status !== "Cancelled" && w.status !== "Completed"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    loadEmployees().then(setEmployees).catch(() => {});
  }, []);

  useListPageCommands({
    singular: "Job Card",
    plural: "Job Cards",
    refresh: load,
  });
  async function loadOpsFor(woId: string) {
    if (operations[woId]) return;
    try {
      const full = await api.get<{ workOrder: { operations: WorkOrderOperation[] } }>(
        `/work-orders/${woId}/full`,
      );
      setOperations((prev) => ({ ...prev, [woId]: full.workOrder.operations ?? [] }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load operations");
    }
  }

  function onWoChange(id: string) {
    setForm({ ...form, workOrderId: id, operationId: "" });
    if (id) loadOpsFor(id);
  }

  function close() {
    setForm(emptyForm);
    setShowForm(false);
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post("/job-cards", {
        workOrderId: form.workOrderId,
        operationId: form.operationId,
        employeeId: form.employeeId || null,
        employeeName: form.employeeName || null,
        remarks: form.remarks || null,
      });
      close();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function startCard(c: JobCard) {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/job-cards/${c.id}/start`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function pauseCard(c: JobCard) {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/job-cards/${c.id}/pause`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }
  async function resumeCard(c: JobCard) {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/job-cards/${c.id}/start`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function completeCard(c: JobCard) {
    const qty = prompt(`Quantity produced on ${c.name}:`, "1");
    if (!qty) return;
    const n = Number(qty);
    if (!Number.isFinite(n) || n <= 0) return;
    let totalTimeMins: number | undefined;
    if (!c.startedAt) {
      const mins = prompt("Total time in minutes (not auto-computed since Start wasn't run):", "0");
      if (mins === null) return;
      totalTimeMins = Number(mins) || 0;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post(`/job-cards/${c.id}/complete`, {
        quantity: n,
        ...(totalTimeMins !== undefined ? { totalTimeMins } : {}),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function cancelCard(c: JobCard) {
    if (!confirm(`Cancel ${c.name}?`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/job-cards/${c.id}/cancel`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const opsForForm = form.workOrderId ? operations[form.workOrderId] ?? [] : [];

  const filtered = useMemo(() => {
    const qs = search.trim().toLowerCase();
    return rows.filter((c) => {
      if (statusFilter !== "all" && c.status !== statusFilter) return false;
      if (qs && !`${c.name} ${c.workOrder.name} ${c.operation.operationName} ${c.employeeName ?? ""}`.toLowerCase().includes(qs)) return false;
      return true;
    });
  }, [rows, search, statusFilter]);

  const counts = useMemo(() => ({
    all:        rows.length,
    Open:       rows.filter((r) => r.status === "Open").length,
    InProgress: rows.filter((r) => r.status === "InProgress").length,
    Paused:     rows.filter((r) => r.status === "Paused").length,
    Completed:  rows.filter((r) => r.status === "Completed").length,
    Cancelled:  rows.filter((r) => r.status === "Cancelled").length,
  }), [rows]);

  const columns: Column<JobCard>[] = [
    {
      header: "Card",
      cell: (c) => (
        <a
          href={`/stock/job-cards/${c.id}`}
          className="font-mono text-xs text-brand-600 hover:text-brand-700"
          onClick={(e) => e.stopPropagation()}
        >
          {c.name}
        </a>
      ),
    },
    {
      header: "Work order",
      cell: (c) => (
        <a
          href={`/stock/work-orders/${c.workOrder.id}`}
          className="text-xs text-brand-600 hover:text-brand-700"
          onClick={(e) => e.stopPropagation()}
        >
          {c.workOrder.name}
        </a>
      ),
    },
    { header: "Operation", cell: (c) => <span className="text-xs text-ink-soft">{c.operation.operationName}</span> },
    { header: "Workstation", cell: (c) => <span className="text-xs text-ink-soft">{c.workstation.name}</span> },
    { header: "Performed by", cell: (c) => <span className="text-xs text-ink-soft">{c.employeeName ?? "—"}</span> },
    {
      header: "Qty",
      align: "right",
      cell: (c) => <span className="tabular-nums text-ink">{Number(c.quantity).toFixed(2)}</span>,
    },
    {
      header: "Time (min)",
      align: "right",
      cell: (c) => <span className="tabular-nums text-ink">{Number(c.totalTimeMins).toFixed(2)}</span>,
    },
    { header: "Status", cell: (c) => <StatusBadge status={c.status} /> },
    {
      header: "",
      align: "right",
      cell: (c) => (
        <span className="space-x-1 text-xs">
          {c.status === "Open" && (
            <button onClick={(e) => { e.stopPropagation(); startCard(c); }} disabled={busy} className="btn-ghost btn-sm">
              Start
            </button>
          )}
          {c.status === "InProgress" && (
            <button onClick={(e) => { e.stopPropagation(); pauseCard(c); }} disabled={busy} className="btn-ghost btn-sm">
              Pause
            </button>
          )}
          {c.status === "Paused" && (
            <button onClick={(e) => { e.stopPropagation(); resumeCard(c); }} disabled={busy} className="btn-ghost btn-sm">
              Resume
            </button>
          )}
          {(c.status === "Open" || c.status === "InProgress" || c.status === "Paused") && (
            <button onClick={(e) => { e.stopPropagation(); completeCard(c); }} disabled={busy} className="btn-ghost btn-sm">
              Complete…
            </button>
          )}
          {c.status !== "Cancelled" && (
            <button onClick={(e) => { e.stopPropagation(); cancelCard(c); }} disabled={busy} className="btn-ghost btn-sm text-red-600">
              Cancel
            </button>
          )}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Job Cards"
        subtitle={`${rows.length} card${rows.length === 1 ? "" : "s"} · ${counts.InProgress} in progress`}
        actions={
          <Button variant="brand" onClick={() => setShowForm(true)}>+ New job card</Button>
        }
      />

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}

      <div className="space-y-4">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search card, WO, operation…" }}
          filters={
            <Segmented
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: "all",        label: "All",         count: counts.all },
                { value: "Open",       label: "Open",        count: counts.Open },
                { value: "InProgress", label: "In Progress", count: counts.InProgress },
                { value: "Paused",     label: "Paused",      count: counts.Paused },
                { value: "Completed",  label: "Completed",   count: counts.Completed },
                { value: "Cancelled",  label: "Cancelled",   count: counts.Cancelled },
              ]}
        />
          }
          actions={<SavedViewsControls listKey="stock-web:job-cards" current={{ search, statusFilter }} onApply={(fv) => { setSearch(fv.search); setStatusFilter(fv.statusFilter); }} />}
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(c) => c.id}
          loading={loading}
          empty={{
            icon: Icon.clipboard,
            title: search || statusFilter !== "all" ? "No matching job cards" : "No job cards yet",
            description: search || statusFilter !== "all"
              ? "Try changing your search or filter."
              : "Log actual work against a Work Order's operation.",
            action: !search && statusFilter === "all" && (
              <Button variant="brand" onClick={() => setShowForm(true)}>+ New job card</Button>
            ),
          }}
        />
      </div>

      <Drawer
        open={showForm}
        onClose={close}
        title="New job card"
        footer={
          <>
            <Button variant="secondary" onClick={close}>Cancel</Button>
            <Button variant="brand" onClick={(e) => create(e as unknown as React.FormEvent)} disabled={busy}>
              Save (as Open)
            </Button>
          </>
        }
      >
        <form onSubmit={create} className="space-y-4">
          <FormField label="Work order" required>
            <select
              required
              className="input"
              value={form.workOrderId}
              onChange={(e) => onWoChange(e.target.value)}
            >
              <option value="">Work order…</option>
              {workOrders.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} ({Number(w.producedQty)}/{Number(w.qty)})
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Operation" required>
            <select
              required
              className="input"
              value={form.operationId}
              onChange={(e) => setForm({ ...form, operationId: e.target.value })}
              disabled={!form.workOrderId}
            >
              <option value="">Operation…</option>
              {opsForForm.map((op) => (
                <option key={op.id} value={op.id}>
                  {op.operationName} — {op.workstation.name} ({Number(op.timeInMins)}m planned)
                </option>
              ))}
            </select>
            {form.workOrderId && opsForForm.length === 0 && (
              <p className="text-[11px] text-amber-600 mt-1">
                This work order has no operations. Add them to the source BOM first.
              </p>
            )}
          </FormField>
          <FormField label="Employee">
            <select
              className="input"
              value={form.employeeId}
              onChange={(e) => {
                const emp = employees.find((x) => x.id === e.target.value);
                setForm({
                  ...form,
                  employeeId: e.target.value,
                  employeeName: emp
                    ? `${emp.employeeName} (${emp.employeeCode})`
                    : form.employeeName,
                });
              }}
            >
              <option value="">— Pick employee (optional) —</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.employeeCode} — {e.employeeName}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Or free-text name">
            <input
              className="input"
              placeholder="Employee name"
              value={form.employeeName}
              onChange={(e) => setForm({ ...form, employeeName: e.target.value })}
            />
          </FormField>
          <FormField label="Remarks">
            <textarea
              className="input"
              placeholder="Optional"
              value={form.remarks}
              onChange={(e) => setForm({ ...form, remarks: e.target.value })}
            />
          </FormField>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </>
  );
}
