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
  money,
  type Column,
} from "../../components/ui";
import { Icon } from "../../components/app-shell";

interface Employee { id: string; employeeCode: string; employeeName: string }
interface LoanType {
  id: string;
  loanTypeName: string;
  interestRate: string;
  defaultTermMonths: number;
}
interface Loan {
  id: string;
  name: string;
  principal: string;
  interestRate: string;
  termMonths: number;
  emi: string;
  outstanding: string;
  status: string;
  employee: Employee;
  loanType: LoanType;
}

type StatusFilter = "all" | "Draft" | "Disbursed" | "Closed" | "Cancelled";

function estimateEmi(principal: number, annualRatePct: number, termMonths: number): number {
  if (termMonths <= 0) return 0;
  if (annualRatePct <= 0) return principal / termMonths;
  const r = annualRatePct / 12 / 100;
  const pow = Math.pow(1 + r, termMonths);
  return (principal * r * pow) / (pow - 1);
}

const emptyForm = {
  employeeId: "",
  loanTypeId: "",
  principal: 0,
  termMonths: 12,
  interestRate: 0,
  remarks: "",
};

export default function LoansPage() {
  const [rows, setRows] = useState<Loan[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [types, setTypes] = useState<LoanType[]>([]);
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
      const [ls, es, ts] = await Promise.all([
        api.get<Loan[]>("/loans"),
        api.get<Employee[]>("/employees"),
        api.get<LoanType[]>("/loan-types"),
      ]);
      setRows(ls);
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
    singular: "Loan",
    plural: "Loans",
    refresh: load,
  });
  function onTypeChange(id: string) {
    const t = types.find((t) => t.id === id);
    setForm({
      ...form,
      loanTypeId: id,
      interestRate: t ? Number(t.interestRate) : 0,
      termMonths: t ? t.defaultTermMonths : form.termMonths,
    });
  }

  const emiPreview = useMemo(
    () => estimateEmi(form.principal, form.interestRate, form.termMonths),
    [form.principal, form.interestRate, form.termMonths],
  );

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post("/loans", { ...form, remarks: form.remarks || null });
      setForm(emptyForm);
      setShowForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function disburse(loan: Loan, e: React.MouseEvent) {
    e.stopPropagation();
    const date = prompt("Disbursement date (YYYY-MM-DD):", new Date().toISOString().slice(0, 10));
    if (!date) return;
    const mode = prompt("Mode (Cash/Bank/UPI/Card):", "Bank");
    if (!mode) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/loans/${loan.id}/disburse`, {
        disbursementDate: new Date(date).toISOString(),
        modeOfPayment: mode,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function cancel(loan: Loan, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`Cancel loan ${loan.name}?`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/loans/${loan.id}/cancel`, {});
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
      if (q && !`${r.name} ${r.employee.employeeName} ${r.employee.employeeCode} ${r.loanType.loanTypeName}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, search, statusFilter]);

  const counts = useMemo(() => ({
    all:       rows.length,
    Draft:     rows.filter((r) => r.status === "Draft").length,
    Disbursed: rows.filter((r) => r.status === "Disbursed").length,
    Closed:    rows.filter((r) => r.status === "Closed").length,
    Cancelled: rows.filter((r) => r.status === "Cancelled").length,
  }), [rows]);

  const totalOutstanding = useMemo(
    () => rows
      .filter((r) => r.status === "Disbursed")
      .reduce((s, r) => s + Number(r.outstanding ?? 0), 0),
    [rows],
  );

  const columns: Column<Loan>[] = [
    {
      header: "Name",
      cell: (l) => (
        <a
          href={`/hr/loans/${l.id}`}
          className="font-mono text-xs text-brand-600 hover:text-brand-700"
          onClick={(e) => e.stopPropagation()}
        >
          {l.name}
        </a>
      ),
    },
    {
      header: "Employee",
      cell: (l) => (
        <div>
          <div className="font-medium text-ink">{l.employee.employeeName}</div>
          <div className="text-xs text-ink-muted font-mono">{l.employee.employeeCode}</div>
        </div>
      ),
    },
    { header: "Type", cell: (l) => <span className="text-ink-soft">{l.loanType.loanTypeName}</span> },
    {
      header: "Principal",
      align: "right",
      cell: (l) => <span className="tabular-nums text-ink-soft">{money(Number(l.principal))}</span>,
    },
    {
      header: "EMI × Term",
      align: "right",
      cell: (l) => (
        <span className="tabular-nums text-xs text-ink-soft">
          {money(Number(l.emi))} × {l.termMonths}
        </span>
      ),
    },
    {
      header: "Outstanding",
      align: "right",
      cell: (l) => <span className="tabular-nums font-medium text-ink">{money(Number(l.outstanding))}</span>,
    },
    { header: "Status", cell: (l) => <StatusBadge status={l.status} /> },
    {
      header: "",
      align: "right",
      cell: (l) =>
        l.status === "Draft" ? (
          <div className="flex items-center gap-1 justify-end">
            <button onClick={(e) => disburse(l, e)} disabled={busy} className="btn-ghost btn-sm text-green-700">Disburse</button>
            <button onClick={(e) => cancel(l, e)} disabled={busy} className="btn-ghost btn-sm">Cancel</button>
          </div>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title="Loans"
        subtitle={
          totalOutstanding > 0
            ? `${money(totalOutstanding)} outstanding across ${counts.Disbursed} disbursed loan${counts.Disbursed === 1 ? "" : "s"}`
            : `${rows.length} loan${rows.length === 1 ? "" : "s"}`
        }
        actions={<Button variant="brand" onClick={() => setShowForm(true)}>+ New loan</Button>}
      />

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}

      <div className="space-y-4">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search loan # or employee…" }}
          filters={
            <Segmented
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: "all",       label: "All",       count: counts.all },
                { value: "Draft",     label: "Draft",     count: counts.Draft },
                { value: "Disbursed", label: "Disbursed", count: counts.Disbursed },
                { value: "Closed",    label: "Closed",    count: counts.Closed },
                { value: "Cancelled", label: "Cancelled", count: counts.Cancelled },
              ]}
        />
          }
          actions={<SavedViewsControls listKey="hr-web:loans" current={{ search, statusFilter }} onApply={(fv) => { setSearch(fv.search); setStatusFilter(fv.statusFilter); }} />}
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(l) => l.id}
          onRowClick={(l) => (window.location.href = `/hr/loans/${l.id}`)}
          loading={loading}
          empty={{
            icon: Icon.cash,
            title: search || statusFilter !== "all" ? "No matching loans" : "No loans yet",
            description: search || statusFilter !== "all"
              ? "Try changing your search or filter."
              : "Set up loan types and record employee loans here.",
            action: !search && statusFilter === "all" && (
              <Button variant="brand" onClick={() => setShowForm(true)}>+ New loan</Button>
            ),
          }}
        />
      </div>

      <Drawer
        open={showForm}
        onClose={() => { setShowForm(false); setForm(emptyForm); }}
        title="New loan"
        width="w-[600px]"
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
            <FormField label="Loan type" required>
              <select
                required
                className="input"
                value={form.loanTypeId}
                onChange={(e) => onTypeChange(e.target.value)}
              >
                <option value="">Select…</option>
                {types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.loanTypeName} ({Number(t.interestRate).toFixed(2)}% / {t.defaultTermMonths}mo)
                  </option>
                ))}
              </select>
            </FormField>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <FormField label="Principal" required>
              <input
                type="number"
                step="any"
                min={1}
                required
                className="input"
                value={form.principal}
                onChange={(e) => setForm({ ...form, principal: Number(e.target.value) })}
              />
            </FormField>
            <FormField label="Term (months)" required>
              <input
                type="number"
                min={1}
                required
                className="input"
                value={form.termMonths}
                onChange={(e) => setForm({ ...form, termMonths: Number(e.target.value) })}
              />
            </FormField>
            <FormField label="Interest %" required>
              <input
                type="number"
                step="0.01"
                min={0}
                required
                className="input"
                value={form.interestRate}
                onChange={(e) => setForm({ ...form, interestRate: Number(e.target.value) })}
              />
            </FormField>
          </div>
          <FormField label="Remarks">
            <textarea
              className="input"
              rows={2}
              value={form.remarks}
              onChange={(e) => setForm({ ...form, remarks: e.target.value })}
            />
          </FormField>
          <div className="text-sm text-ink-soft border-t border-ink-muted/10 pt-3">
            Estimated EMI:{" "}
            <b className="font-mono text-ink">
              {emiPreview > 0 ? money(emiPreview) : "—"}
            </b>
            <span className="text-xs text-ink-muted ms-2">
              × {form.termMonths} = {emiPreview > 0 ? money(emiPreview * form.termMonths) : "—"}
            </span>
          </div>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </>
  );
}
