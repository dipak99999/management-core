"use client";

import { useEffect, useState } from "react";
import { showToast } from "../../../lib/toast";
import { useParams } from "next/navigation";
import { api, downloadPdf } from "../../../lib/api";
import { WorkflowActions } from "../../../lib/workflow-actions";
import { AttachmentsPanel } from "../../../lib/attachments";
import { CommentsPanel } from "../../../lib/comments";
import { currentUserId } from "../../../lib/collab-api";
import {
  Button,
  Card,
  DataTable,
  PageHeader,
  SectionHeader,
  Skeleton,
  StatusBadge,
  dateShort,
  money,
  type Column,
} from "../../../components/ui";

interface Component {
  id: string;
  componentName: string;
  type: string;
  amount: string;
}
interface SalarySlip {
  id: string;
  name: string;
  status: string;
  startDate: string;
  endDate: string;
  grossPay: string;
  totalDeduction: string;
  netPay: string;
  remarks: string | null;
  employee: {
    id: string;
    employeeCode: string;
    employeeName: string;
    designation: string | null;
    department: string | null;
  };
  components: Component[];
}
interface GLEntry {
  id: string;
  accountId: string;
  debit: string;
  credit: string;
  remarks: string | null;
  account: { accountName: string; rootType: string };
}
interface Payload {
  salarySlip: SalarySlip;
  glEntries: GLEntry[];
}

export default function SalarySlipDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setData(await api.get<Payload>(`/salary-slips/${params.id}/full`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/salary-slips/${params.id}/submit`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submit failed");
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    if (!confirm("Cancel this salary slip? GL will be reversed.")) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/salary-slips/${params.id}/cancel`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cancel failed");
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[{ label: "Salary Slips", href: "/hr/salary-slips" }]}
          title="Salary Slip"
        />
        <Card className="p-4 text-red-700 border-red-200 bg-red-50">{error}</Card>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[{ label: "Salary Slips", href: "/hr/salary-slips" }]}
          title="Loading…"
        />
        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20" rounded="rounded-lg" />
          ))}
        </div>
      </main>
    );
  }

  const s = data.salarySlip;
  const earnings = s.components.filter((c) => c.type === "Earning");
  const deductions = s.components.filter((c) => c.type === "Deduction");

  const glCols: Column<GLEntry>[] = [
    {
      header: "Account",
      cell: (g) => (
        <span>
          <a
            href={`/accounting/reports/general-ledger?accountId=${g.accountId}`}
            className="text-brand-600 hover:underline"
          >
            {g.account.accountName}
          </a>{" "}
          <span className="text-xs text-ink-muted">({g.account.rootType})</span>
        </span>
      ),
    },
    {
      header: "Debit",
      align: "right",
      cell: (g) => (
        <span className="tabular-nums font-mono">
          {Number(g.debit) > 0 ? money(Number(g.debit)) : ""}
        </span>
      ),
    },
    {
      header: "Credit",
      align: "right",
      cell: (g) => (
        <span className="tabular-nums font-mono">
          {Number(g.credit) > 0 ? money(Number(g.credit)) : ""}
        </span>
      ),
    },
  ];

  const subtitle = (
    <span className="flex items-center gap-2">
      <StatusBadge status={s.status} />
      <span className="text-ink-muted">
        {dateShort(s.startDate)} → {dateShort(s.endDate)}
      </span>
    </span>
  );

  return (
    <main className="p-8 space-y-6 print:p-0">
      <PageHeader
        breadcrumb={[
          { label: "Salary Slips", href: "/hr/salary-slips" },
          { label: s.name },
        ]}
        title={s.name}
        subtitle={subtitle}
        actions={
          <div className="print:hidden flex items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => history.back()}
              type="button"
            >
              ← Back
            </Button>
            {s.status === "Draft" && (
              <>
                <a href={`/hr/salary-slips/new?editId=${s.id}`}>
                  <Button variant="secondary" type="button">
                    Edit
                  </Button>
                </a>
                <Button
                  variant="primary"
                  onClick={submit}
                  disabled={busy}
                  type="button"
                >
                  Submit
                </Button>
              </>
            )}
            {s.status !== "Cancelled" && (
              <Button
                variant="danger"
                onClick={cancel}
                disabled={busy}
                type="button"
              >
                Cancel
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={() =>
                downloadPdf(`/print/salary-slips/${s.id}`, `${s.name}.pdf`).catch(
                  (e) => showToast(e instanceof Error ? e.message : "PDF failed", "error"),
                )
              }
              type="button"
            >
              PDF
            </Button>
            <Button
              variant="secondary"
              onClick={() => window.print()}
              type="button"
            >
              Print
            </Button>
          </div>
        }
      />

      <WorkflowActions doctype="SalarySlip" docId={s.id} onChange={load} />

      <section className="grid grid-cols-3 gap-3">
        <Card className="p-4">
          <SectionHeader title="Employee" />
          <a
            href={`/hr/employees/${s.employee.id}`}
            className="font-semibold text-brand-600 hover:underline"
          >
            {s.employee.employeeName}
          </a>
          <div className="font-mono text-xs text-ink-muted">
            {s.employee.employeeCode}
          </div>
          <div className="text-xs text-ink-muted mt-1">
            {s.employee.designation ?? "—"} · {s.employee.department ?? "—"}
          </div>
        </Card>
        <Card className="p-4">
          <SectionHeader title="Gross → Net" />
          <div className="text-sm flex justify-between">
            <span className="text-ink-muted">Gross</span>
            <span className="tabular-nums">{money(Number(s.grossPay))}</span>
          </div>
          <div className="text-sm flex justify-between text-red-700">
            <span>− Deductions</span>
            <span className="tabular-nums">
              {money(Number(s.totalDeduction))}
            </span>
          </div>
          <div className="text-sm flex justify-between font-semibold border-t border-ink-muted/10 pt-1 mt-1">
            <span>Net</span>
            <span className="tabular-nums">{money(Number(s.netPay))}</span>
          </div>
        </Card>
        <Card className="p-4">
          <SectionHeader title="Net take-home" />
          <div className="font-semibold text-2xl tabular-nums">
            {money(Number(s.netPay))}
          </div>
        </Card>
      </section>

      <section className="grid md:grid-cols-2 gap-4">
        <Card className="p-0 overflow-hidden">
          <div className="px-4 pt-3 pb-2">
            <SectionHeader title="Earnings" />
          </div>
          <table className="table">
            <tbody>
              {earnings.length === 0 && (
                <tr>
                  <td className="text-center text-ink-muted text-sm">
                    No earnings
                  </td>
                </tr>
              )}
              {earnings.map((c) => (
                <tr key={c.id}>
                  <td>{c.componentName}</td>
                  <td className="text-end font-mono tabular-nums">
                    {money(Number(c.amount))}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-surface-sunken font-semibold">
              <tr>
                <td>Gross</td>
                <td className="text-end tabular-nums">
                  {money(Number(s.grossPay))}
                </td>
              </tr>
            </tfoot>
          </table>
        </Card>
        <Card className="p-0 overflow-hidden">
          <div className="px-4 pt-3 pb-2">
            <SectionHeader title="Deductions" />
          </div>
          <table className="table">
            <tbody>
              {deductions.length === 0 && (
                <tr>
                  <td className="text-center text-ink-muted text-sm">
                    No deductions
                  </td>
                </tr>
              )}
              {deductions.map((c) => (
                <tr key={c.id}>
                  <td>{c.componentName}</td>
                  <td className="text-end font-mono tabular-nums">
                    {money(Number(c.amount))}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-surface-sunken font-semibold">
              <tr>
                <td>Total deductions</td>
                <td className="text-end tabular-nums">
                  {money(Number(s.totalDeduction))}
                </td>
              </tr>
            </tfoot>
          </table>
        </Card>
      </section>

      <section className="print:hidden">
        <SectionHeader title="GL entries (payroll accrual)" />
        <div className="hidden md:block">
          <DataTable<GLEntry>
            columns={glCols}
            rows={data.glEntries}
            rowKey={(g) => g.id}
            empty={{ title: "Not posted yet" }}
          />
        </div>
        {data.glEntries.length === 0 ? (
          <div className="md:hidden rounded-xl border border-ink/10 bg-canvas px-4 py-6 text-center text-sm text-ink-muted">
            Not posted yet
          </div>
        ) : (
          <ul className="md:hidden divide-y divide-line rounded-xl border border-ink/10 bg-canvas overflow-hidden">
            {data.glEntries.map((g) => (
              <li key={g.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-ink truncate">{g.account.accountName}</div>
                    {g.remarks && <div className="text-xs text-ink-muted">{g.remarks}</div>}
                  </div>
                  <div className="text-end font-mono tabular-nums">
                    {Number(g.debit) > 0 ? (
                      <span className="text-ink">Dr {money(Number(g.debit))}</span>
                    ) : (
                      <span className="text-ink">Cr {money(Number(g.credit))}</span>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {s.remarks && (
        <Card className="p-4">
          <SectionHeader title="Remarks" />
          <div className="whitespace-pre-wrap text-sm">{s.remarks}</div>
        </Card>
      )}

      <section className="grid grid-cols-2 gap-4 print:hidden">
        <AttachmentsPanel doctype="SalarySlip" docId={s.id} />
        <CommentsPanel
          doctype="SalarySlip"
          docId={s.id}
          currentUserId={currentUserId()}
        />
      </section>
    </main>
  );
}
