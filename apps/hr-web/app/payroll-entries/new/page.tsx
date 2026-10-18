"use client";

import { useEffect, useState } from "react";
import { useOptionalUIBackends, useSmartDefaults } from "@lumaara/web-ui";
import { api } from "../../../lib/api";
import {
  Button,
  Card,
  DataTable,
  FormField,
  PageHeader,
  SectionHeader,
  money,
  type Column,
} from "../../../components/ui";

interface EmployeePreview {
  id: string;
  employeeCode: string;
  employeeName: string;
  department: string | null;
  designation: string | null;
  baseSalary: string;
}

export default function NewPayrollEntryPage() {
  const now = new Date();
  const monthStart = new Date(now.getUTCFullYear(), now.getUTCMonth(), 1)
    .toISOString()
    .slice(0, 10);
  const monthEnd = new Date(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)
    .toISOString()
    .slice(0, 10);

  const [startDate, setStartDate] = useState(monthStart);
  const [endDate, setEndDate] = useState(monthEnd);
  const [department, setDepartment] = useState("");
  const [designation, setDesignation] = useState("");
  const [paymentMode, setPaymentMode] = useState<"Bank" | "Cash">("Bank");
  const [preview, setPreview] = useState<EmployeePreview[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Smart defaults: payroll admins typically run the same filter each month
  // (department/designation/paymentMode). Pre-fill from last run.
  const uiBackends = useOptionalUIBackends();
  const smart = useSmartDefaults<{
    department: string;
    designation: string;
    paymentMode: "Bank" | "Cash";
  }>("hr-web:payroll-entry-create", uiBackends?.defaults);
  useEffect(() => {
    if (!smart.last) return;
    if (smart.last.department && !department) setDepartment(smart.last.department);
    if (smart.last.designation && !designation) setDesignation(smart.last.designation);
    if (smart.last.paymentMode) setPaymentMode(smart.last.paymentMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [smart.last?.department, smart.last?.designation, smart.last?.paymentMode]);

  function payload() {
    return {
      startDate: new Date(startDate).toISOString(),
      endDate: new Date(endDate).toISOString(),
      department: department || null,
      designation: designation || null,
      paymentMode,
    };
  }

  async function doPreview() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ employees: EmployeePreview[] }>(
        "/payroll-entries/preview",
        payload(),
      );
      setPreview(r.employees);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ id: string }>("/payroll-entries", payload());
      smart.remember({ department, designation, paymentMode });
      window.location.href = `/hr/payroll-entries/${r.id}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const cols: Column<EmployeePreview>[] = [
    {
      header: "Code",
      cell: (e) => (
        <span className="font-mono text-xs">{e.employeeCode}</span>
      ),
    },
    { header: "Name", cell: (e) => e.employeeName },
    {
      header: "Department",
      cell: (e) => <span className="text-xs">{e.department ?? "—"}</span>,
    },
    {
      header: "Designation",
      cell: (e) => <span className="text-xs">{e.designation ?? "—"}</span>,
    },
    {
      header: "Base",
      align: "right",
      cell: (e) => (
        <span className="tabular-nums">{money(Number(e.baseSalary))}</span>
      ),
    },
  ];

  return (
    <main className="p-8 space-y-6 max-w-4xl">
      <PageHeader
        breadcrumb={[
          { label: "Payroll Entries", href: "/hr/payroll-entries" },
          { label: "New" },
        ]}
        title="New payroll entry"
        actions={
          <Button
            variant="secondary"
            onClick={() => history.back()}
            type="button"
          >
            ← Back
          </Button>
        }
      />

      {error && (
        <Card className="p-4 text-red-700 border-red-200 bg-red-50 text-sm">
          {error}
        </Card>
      )}

      <Card className="p-6 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <FormField label="From">
            <input
              type="date"
              className="input"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </FormField>
          <FormField label="To">
            <input
              type="date"
              className="input"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </FormField>
          {showAdvanced && (
            <>
              <FormField label="Department (optional)">
                <input
                  className="input"
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  placeholder="e.g. Engineering"
                />
              </FormField>
              <FormField label="Designation (optional)">
                <input
                  className="input"
                  value={designation}
                  onChange={(e) => setDesignation(e.target.value)}
                />
              </FormField>
            </>
          )}
          <FormField label="Payment mode">
            <select
              className="input"
              value={paymentMode}
              onChange={(e) =>
                setPaymentMode(e.target.value as "Bank" | "Cash")
              }
            >
              <option value="Bank">Bank</option>
              <option value="Cash">Cash</option>
            </select>
          </FormField>
        </div>

        <div className="flex items-center">
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="text-xs text-ink-muted hover:text-ink-soft transition-colors"
          >
            {showAdvanced ? "− Hide" : "+ Scope by"} department / designation
          </button>
        </div>

        <div className="flex gap-2 justify-end">
          <Button
            variant="secondary"
            onClick={doPreview}
            disabled={busy}
            type="button"
          >
            Preview employees
          </Button>
          <Button
            variant="primary"
            onClick={create}
            disabled={busy || preview.length === 0}
            type="button"
          >
            Create draft
          </Button>
        </div>
      </Card>

      {preview.length > 0 && (
        <section>
          <SectionHeader title={`${preview.length} matching employee(s)`} />
          <DataTable<EmployeePreview>
            columns={cols}
            rows={preview}
            rowKey={(e) => e.id}
            empty={{
              title: "No employees match these filters",
              description: "Relax the department, designation, or salary-structure filter to include more employees.",
            }}
          />
        </section>
      )}
    </main>
  );
}
