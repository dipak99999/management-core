"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useOptionalUIBackends, useSmartDefaults } from "@lumaara/web-ui";
import { api } from "../../../lib/api";
import {
  Button,
  Card,
  FormField,
  PageHeader,
  money,
} from "../../../components/ui";

interface Employee { id: string; employeeCode: string; employeeName: string; baseSalary: string }

interface Component { componentName: string; type: "Earning" | "Deduction"; amount: number }
interface ExistingSS {
  status: string;
  employeeId: string;
  startDate: string;
  endDate: string;
  remarks: string | null;
  components: { componentName: string; type: string; amount: string }[];
}

const emptyEarning: Component = { componentName: "", type: "Earning", amount: 0 };
const emptyDeduction: Component = { componentName: "", type: "Deduction", amount: 0 };

function firstOfMonth(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}
function lastOfMonth(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
}

function InnerNewSalarySlipPage() {
  const searchParams = useSearchParams();
  const editId = searchParams.get("editId");

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [startDate, setStartDate] = useState(firstOfMonth());
  const [endDate, setEndDate] = useState(lastOfMonth());
  const [components, setComponents] = useState<Component[]>([{ ...emptyEarning }]);
  const [remarks, setRemarks] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Smart defaults: remember the last period boundaries so creating the next
  // month's slip for a different employee doesn't require re-picking dates.
  const uiBackends = useOptionalUIBackends();
  const smart = useSmartDefaults<{ startDate: string; endDate: string }>(
    "hr-web:salary-slip-create",
    uiBackends?.defaults,
  );
  useEffect(() => {
    if (editId || !smart.last) return;
    if (smart.last.startDate) setStartDate(smart.last.startDate);
    if (smart.last.endDate) setEndDate(smart.last.endDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [smart.last?.startDate, smart.last?.endDate]);

  useEffect(() => {
    api.get<Employee[]>("/employees").then(setEmployees).catch(() => {});
  }, []);

  useEffect(() => {
    if (!editId) return;
    api
      .get<ExistingSS>(`/salary-slips/${editId}`)
      .then((ss) => {
        if (ss.status !== "Draft") {
          setError(`Cannot edit slip in status ${ss.status}`);
          return;
        }
        setEmployeeId(ss.employeeId);
        setStartDate(ss.startDate.slice(0, 10));
        setEndDate(ss.endDate.slice(0, 10));
        setRemarks(ss.remarks ?? "");
        setComponents(
          ss.components.length
            ? ss.components.map((c) => ({
                componentName: c.componentName,
                type: c.type as "Earning" | "Deduction",
                amount: Number(c.amount),
              }))
            : [{ ...emptyEarning }],
        );
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [editId]);

  function onEmployeeChange(id: string) {
    setEmployeeId(id);
    const emp = employees.find((e) => e.id === id);
    if (!emp) return;
    setComponents((cs) => {
      if (cs.length && cs[0].type === "Earning" && !cs[0].componentName) {
        return [{ componentName: "Basic", type: "Earning", amount: Number(emp.baseSalary) }, ...cs.slice(1)];
      }
      return cs;
    });
  }

  const grossPay = useMemo(
    () => components.filter((c) => c.type === "Earning").reduce((s, c) => s + (Number(c.amount) || 0), 0),
    [components],
  );
  const totalDeduction = useMemo(
    () => components.filter((c) => c.type === "Deduction").reduce((s, c) => s + (Number(c.amount) || 0), 0),
    [components],
  );
  const netPay = grossPay - totalDeduction;

  function updateComponent(idx: number, patch: Partial<Component>) {
    setComponents((cs) => cs.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  }
  function removeComponent(idx: number) {
    setComponents((cs) => cs.filter((_, i) => i !== idx));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const body = {
        employeeId,
        startDate,
        endDate,
        remarks,
        components: components
          .filter((c) => c.componentName && c.amount > 0)
          .map((c) => ({ ...c })),
      };
      if (editId) {
        await api.put(`/salary-slips/${editId}`, body);
        location.href = `/hr/salary-slips/${editId}`;
      } else {
        await api.post("/salary-slips", body);
        smart.remember({ startDate, endDate });
        location.href = "/hr/salary-slips";
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="p-8 space-y-6 max-w-3xl">
      <PageHeader
        breadcrumb={[
          { label: "Salary Slips", href: "/hr/salary-slips" },
          { label: editId ? "Edit" : "New" },
        ]}
        title={editId ? "Edit salary slip" : "New salary slip"}
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
          <div className="grid grid-cols-3 gap-3">
            <FormField label="Employee" required>
              <select
                required
                className="input"
                value={employeeId}
                onChange={(e) => onEmployeeChange(e.target.value)}
              >
                <option value="">Select…</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.employeeCode} — {emp.employeeName}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Period start" required>
              <input
                type="date"
                required
                className="input"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </FormField>
            <FormField label="Period end" required>
              <input
                type="date"
                required
                className="input"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </FormField>
          </div>

          <div>
            <label className="label">Components</label>
            <table className="table">
              <thead>
                <tr>
                  <th className="text-start">Name (e.g. Basic, HRA, Tax)</th>
                  <th className="text-start w-32">Type</th>
                  <th className="text-end w-32">Amount</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {components.map((c, idx) => (
                  <tr key={idx}>
                    <td>
                      <input
                        className="input"
                        value={c.componentName}
                        onChange={(e) =>
                          updateComponent(idx, { componentName: e.target.value })
                        }
                      />
                    </td>
                    <td>
                      <select
                        className="input"
                        value={c.type}
                        onChange={(e) =>
                          updateComponent(idx, {
                            type: e.target.value as "Earning" | "Deduction",
                          })
                        }
                      >
                        <option>Earning</option>
                        <option>Deduction</option>
                      </select>
                    </td>
                    <td>
                      <input
                        type="number"
                        step="any"
                        min={0}
                        className="input text-end"
                        value={c.amount}
                        onChange={(e) =>
                          updateComponent(idx, { amount: Number(e.target.value) })
                        }
                      />
                    </td>
                    <td className="text-end">
                      {components.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeComponent(idx)}
                          className="text-red-500 text-xs"
                        >
                          ✕
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-2 space-x-3 text-sm">
              <button
                type="button"
                onClick={() => setComponents([...components, { ...emptyEarning }])}
                className="text-brand-600 hover:underline"
              >
                + Earning
              </button>
              <button
                type="button"
                onClick={() =>
                  setComponents([...components, { ...emptyDeduction }])
                }
                className="text-brand-600 hover:underline"
              >
                + Deduction
              </button>
            </div>
          </div>

          <FormField label="Remarks">
            <textarea
              className="input"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
            />
          </FormField>

          <div className="flex items-center justify-between border-t border-ink-muted/10 pt-3">
            <div className="text-sm tabular-nums flex gap-4">
              <span>
                Gross: <b>{money(grossPay)}</b>
              </span>
              <span>
                Deductions: <b>{money(totalDeduction)}</b>
              </span>
              <span>
                Net: <b>{money(netPay)}</b>
              </span>
            </div>
            <Button
              variant="primary"
              type="submit"
              disabled={busy || !employeeId || grossPay <= 0}
            >
              {busy ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </Card>
    </main>
  );
}

export default function NewSalarySlipPage() {
  return (
    <Suspense fallback={null}>
      <InnerNewSalarySlipPage />
    </Suspense>
  );
}
