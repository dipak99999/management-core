"use client";

import { useEffect, useState } from "react";
import { useOptionalUIBackends, useSmartDefaults } from "@lumaara/web-ui";
import { api } from "../../../lib/api";
import {
  Button,
  Card,
  FormField,
  PageHeader,
} from "../../../components/ui";

interface Employee {
  id: string;
  employeeCode: string;
  employeeName: string;
}

export default function NewEmployeeAdvancePage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [form, setForm] = useState({
    employeeId: "",
    postingDate: new Date().toISOString().slice(0, 10),
    purpose: "",
    advanceAmount: "",
    modeOfPayment: "Bank" as "Bank" | "Cash",
    remarks: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Smart defaults: an admin filing one advance usually files more for the
  // same employee immediately after (trip reimbursements). Pre-fill employee
  // + preferred mode of payment.
  const uiBackends = useOptionalUIBackends();
  const smart = useSmartDefaults<{ employeeId: string; modeOfPayment: "Bank" | "Cash" }>(
    "hr-web:employee-advance-create",
    uiBackends?.defaults,
  );
  useEffect(() => {
    if (!smart.last) return;
    setForm((f) => ({
      ...f,
      employeeId: f.employeeId || smart.last!.employeeId || f.employeeId,
      modeOfPayment: smart.last!.modeOfPayment ?? f.modeOfPayment,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [smart.last?.employeeId, smart.last?.modeOfPayment]);

  useEffect(() => {
    (async () => {
      try {
        setEmployees(await api.get<Employee[]>("/employees"));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed");
      }
    })();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ id: string }>("/employee-advances", {
        employeeId: form.employeeId,
        postingDate: new Date(form.postingDate).toISOString(),
        purpose: form.purpose,
        advanceAmount: Number(form.advanceAmount),
        modeOfPayment: form.modeOfPayment,
        remarks: form.remarks || null,
      });
      smart.remember({ employeeId: form.employeeId, modeOfPayment: form.modeOfPayment });
      window.location.href = `/hr/employee-advances/${r.id}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="p-8 space-y-6 max-w-2xl">
      <PageHeader
        breadcrumb={[
          { label: "Employee Advances", href: "/hr/employee-advances" },
          { label: "New" },
        ]}
        title="New employee advance"
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

      <Card className="p-6">
        <form onSubmit={submit} className="space-y-4">
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
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Posting date">
              <input
                type="date"
                className="input"
                value={form.postingDate}
                onChange={(e) => setForm({ ...form, postingDate: e.target.value })}
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
                <option value="Bank">Bank</option>
                <option value="Cash">Cash</option>
              </select>
            </FormField>
          </div>
          <FormField label="Purpose" required>
            <input
              className="input"
              placeholder="e.g. Travel — Bangalore trip"
              value={form.purpose}
              onChange={(e) => setForm({ ...form, purpose: e.target.value })}
              required
            />
          </FormField>
          <FormField label="Amount" required>
            <input
              type="number"
              step="0.01"
              min="0"
              className="input"
              value={form.advanceAmount}
              onChange={(e) =>
                setForm({ ...form, advanceAmount: e.target.value })
              }
              required
            />
          </FormField>
          <FormField label="Remarks (optional)">
            <textarea
              className="input"
              value={form.remarks}
              onChange={(e) => setForm({ ...form, remarks: e.target.value })}
            />
          </FormField>
          <div className="flex justify-end">
            <Button variant="primary" type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save draft"}
            </Button>
          </div>
        </form>
      </Card>
    </main>
  );
}
