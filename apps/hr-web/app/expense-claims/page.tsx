"use client";

import { useEffect, useMemo, useState } from "react";
import { useListPageCommands,
  useOptionalUIBackends,
  useSmartDefaults, SavedViewsControls, useRealtimeList } from "@lumaara/web-ui";
import { showToast } from "../../lib/toast";
import { api, downloadPdf } from "../../lib/api";
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
  money,
  type Column,
} from "../../components/ui";
import { Icon } from "../../components/app-shell";
import { ScanReceiptButton } from "../../components/scan-receipt-button";

interface Employee { id: string; employeeCode: string; employeeName: string }
interface ClaimType { id: string; typeName: string }
interface Claim {
  id: string;
  name: string;
  postingDate: string;
  totalAmount: string;
  status: string;
  remarks: string | null;
  employee: Employee;
  _count: { items: number };
}

interface LineForm {
  expenseClaimTypeId: string;
  description: string;
  amount: number;
}

type StatusFilter = "all" | "Draft" | "Approved" | "Rejected" | "Paid" | "Cancelled";

const emptyLine: LineForm = { expenseClaimTypeId: "", description: "", amount: 0 };

export default function ExpenseClaimsPage() {
  const [rows, setRows] = useState<Claim[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [types, setTypes] = useState<ClaimType[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [postingDate, setPostingDate] = useState(new Date().toISOString().slice(0, 10));
  const [remarks, setRemarks] = useState("");
  const [lines, setLines] = useState<LineForm[]>([{ ...emptyLine }]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  async function load() {
    setLoading(true);
    try {
      const [cs, es, ts] = await Promise.all([
        api.get<Claim[]>("/expense-claims"),
        api.get<Employee[]>("/employees"),
        api.get<ClaimType[]>("/expense-claim-types"),
      ]);
      setRows(cs);
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
    singular: "Expense Claim",
    plural: "Expense Claims",
    refresh: load,
  });
  useRealtimeList("expense-claim", load);
  function updateLine(i: number, patch: Partial<LineForm>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function removeLine(i: number) {
    setLines((ls) => ls.filter((_, idx) => idx !== i));
  }

  const total = useMemo(
    () => lines.reduce((s, l) => s + Number(l.amount || 0), 0),
    [lines],
  );

  function resetForm() {
    setEmployeeId("");
    setRemarks("");
    setLines([{ ...emptyLine }]);
    setPostingDate(new Date().toISOString().slice(0, 10));
  }

  // Smart defaults: pre-fill the last employee when the drawer opens.
  // Employees often file multiple claims in the same session; filling
  // once removes the picker on the next click.
  const uiBackends = useOptionalUIBackends();
  const smart = useSmartDefaults<{ employeeId: string }>(
    "hr-web:expense-claim-create",
    uiBackends?.defaults,
  );
  useEffect(() => {
    if (!showForm) return;
    if (employeeId || !smart.last?.employeeId) return;
    setEmployeeId(smart.last.employeeId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showForm, smart.last?.employeeId]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post("/expense-claims", {
        employeeId,
        postingDate: new Date(postingDate).toISOString(),
        remarks: remarks || null,
        items: lines
          .filter((l) => l.expenseClaimTypeId && l.amount > 0)
          .map((l) => ({
            expenseClaimTypeId: l.expenseClaimTypeId,
            description: l.description || null,
            amount: l.amount,
          })),
      });
      smart.remember({ employeeId });
      resetForm();
      setShowForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function act(id: string, action: "approve" | "reject" | "cancel", e: React.MouseEvent) {
    e.stopPropagation();
    setBusy(true);
    setError(null);
    try {
      await api.post(`/expense-claims/${id}/${action}`, {});
      await load();
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
      if (q && !`${r.name} ${r.employee.employeeName} ${r.employee.employeeCode} ${r.remarks ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, search, statusFilter]);

  const counts = useMemo(() => ({
    all:       rows.length,
    Draft:     rows.filter((r) => r.status === "Draft").length,
    Approved:  rows.filter((r) => r.status === "Approved").length,
    Rejected:  rows.filter((r) => r.status === "Rejected").length,
    Paid:      rows.filter((r) => r.status === "Paid").length,
    Cancelled: rows.filter((r) => r.status === "Cancelled").length,
  }), [rows]);

  const totalApproved = useMemo(
    () => rows
      .filter((r) => r.status === "Approved")
      .reduce((s, r) => s + Number(r.totalAmount ?? 0), 0),
    [rows],
  );

  const columns: Column<Claim>[] = [
    {
      header: "Name",
      cell: (c) => (
        <a
          href={`/hr/expense-claims/${c.id}`}
          className="font-mono text-xs text-brand-600 hover:text-brand-700"
          onClick={(e) => e.stopPropagation()}
        >
          {c.name}
        </a>
      ),
    },
    {
      header: "Employee",
      cell: (c) => (
        <div>
          <div className="font-medium text-ink">{c.employee.employeeName}</div>
          <div className="text-xs text-ink-muted font-mono">{c.employee.employeeCode}</div>
        </div>
      ),
    },
    { header: "Date", cell: (c) => <span className="text-ink-soft">{dateShort(c.postingDate)}</span> },
    {
      header: "Items",
      align: "right",
      cell: (c) => <span className="tabular-nums text-ink">{c._count.items}</span>,
    },
    {
      header: "Total",
      align: "right",
      cell: (c) => <span className="tabular-nums font-medium text-ink">{money(Number(c.totalAmount))}</span>,
    },
    { header: "Status", cell: (c) => <StatusBadge status={c.status} /> },
    {
      header: "",
      align: "right",
      cell: (c) => (
        <div className="flex items-center gap-1 justify-end">
          <button
            onClick={(e) => {
              e.stopPropagation();
              downloadPdf(`/print/expense-claims/${c.id}`, `${c.name}.pdf`).catch(
                (e) => showToast(e instanceof Error ? e.message : "PDF failed", "error"),
              );
            }}
            className="btn-ghost btn-sm"
          >
            PDF
          </button>
          {c.status === "Draft" && (
            <>
              <button onClick={(e) => act(c.id, "approve", e)} disabled={busy} className="btn-ghost btn-sm text-green-700">Approve</button>
              <button onClick={(e) => act(c.id, "reject", e)} disabled={busy} className="btn-ghost btn-sm text-red-600">Reject</button>
            </>
          )}
          {c.status !== "Cancelled" && (
            <button onClick={(e) => act(c.id, "cancel", e)} disabled={busy} className="btn-ghost btn-sm">Cancel</button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Expense Claims"
        subtitle={
          totalApproved > 0
            ? `${money(totalApproved)} approved and awaiting payment`
            : `${rows.length} claim${rows.length === 1 ? "" : "s"}`
        }
        actions={
          <>
            <ScanReceiptButton employees={employees} claimTypes={types} onCreated={load} />
            <Button variant="brand" onClick={() => setShowForm(true)}>+ New claim</Button>
          </>
        }
      />

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}

      <div className="space-y-4">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search claim, employee, remarks…" }}
          filters={
            <Segmented
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: "all",       label: "All",       count: counts.all },
                { value: "Draft",     label: "Draft",     count: counts.Draft },
                { value: "Approved",  label: "Approved",  count: counts.Approved },
                { value: "Rejected",  label: "Rejected",  count: counts.Rejected },
                { value: "Paid",      label: "Paid",      count: counts.Paid },
                { value: "Cancelled", label: "Cancelled", count: counts.Cancelled },
              ]}
        />
          }
          actions={<SavedViewsControls listKey="hr-web:expense-claims" current={{ search, statusFilter }} onApply={(fv) => { setSearch(fv.search); setStatusFilter(fv.statusFilter); }} />}
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(c) => c.id}
          onRowClick={(c) => (window.location.href = `/hr/expense-claims/${c.id}`)}
          loading={loading}
          empty={{
            icon: Icon.cash,
            title: search || statusFilter !== "all" ? "No matching claims" : "No claims yet",
            description: search || statusFilter !== "all"
              ? "Try changing your search or filter."
              : "Employees can file reimbursement claims here.",
            action: !search && statusFilter === "all" && (
              <Button variant="brand" onClick={() => setShowForm(true)}>+ New claim</Button>
            ),
          }}
        />
      </div>

      <Drawer
        open={showForm}
        onClose={() => { setShowForm(false); resetForm(); }}
        title="New expense claim"
        width="w-[680px]"
        footer={
          <>
            <Button variant="secondary" onClick={() => { setShowForm(false); resetForm(); }}>Cancel</Button>
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
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
              >
                <option value="">Select…</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>{emp.employeeName} ({emp.employeeCode})</option>
                ))}
              </select>
            </FormField>
            <FormField label="Posting date" required>
              <input
                type="date"
                required
                className="input"
                value={postingDate}
                onChange={(e) => setPostingDate(e.target.value)}
              />
            </FormField>
          </div>

          <div>
            <div className="flex items-baseline justify-between mb-2">
              <label className="label mb-0">Items</label>
              <button
                type="button"
                onClick={() => setLines([...lines, { ...emptyLine }])}
                className="btn-ghost btn-sm text-brand-600"
              >
                + Add line
              </button>
            </div>
            <table className="w-full text-sm">
              <thead className="text-ink-muted text-start text-xs">
                <tr>
                  <th className="py-1 w-48">Type</th>
                  <th className="py-1">Description</th>
                  <th className="py-1 w-28 text-end">Amount</th>
                  <th className="py-1 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} className="border-t border-ink-muted/10">
                    <td className="py-1 pe-2">
                      <select
                        required
                        className="input"
                        value={l.expenseClaimTypeId}
                        onChange={(e) => updateLine(i, { expenseClaimTypeId: e.target.value })}
                      >
                        <option value="">Select…</option>
                        {types.map((t) => (
                          <option key={t.id} value={t.id}>{t.typeName}</option>
                        ))}
                      </select>
                    </td>
                    <td className="py-1 pe-2">
                      <input
                        className="input"
                        placeholder="Description (optional)"
                        value={l.description}
                        onChange={(e) => updateLine(i, { description: e.target.value })}
                      />
                    </td>
                    <td className="py-1 pe-2">
                      <input
                        type="number"
                        step="any"
                        min={0}
                        className="input text-end"
                        value={l.amount}
                        onChange={(e) => updateLine(i, { amount: Number(e.target.value) })}
                      />
                    </td>
                    <td className="py-1 text-end">
                      <button
                        type="button"
                        onClick={() => removeLine(i)}
                        className="text-red-600 text-xs"
                        aria-label="Remove line"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="text-sm font-semibold">
                <tr className="border-t border-ink-muted/10">
                  <td colSpan={2} className="py-2 pe-2 text-end text-ink-soft">Total</td>
                  <td className="py-2 pe-2 text-end font-mono tabular-nums text-ink">{money(total)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>

          <FormField label="Remarks">
            <textarea
              className="input"
              rows={2}
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
