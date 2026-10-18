"use client";

import { showToast } from "../../../lib/toast";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, downloadPdf } from "../../../lib/api";
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

interface Schedule {
  id: string;
  installmentNo: number;
  dueDate: string;
  principalAmount: string;
  interestAmount: string;
  totalAmount: string;
  balanceAfter: string;
  isPaid: boolean;
  paidAt: string | null;
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
  disbursementDate: string | null;
  remarks: string | null;
  employee: { id: string; employeeCode: string; employeeName: string };
  loanType: { id: string; loanTypeName: string };
  schedule: Schedule[];
}

function Kpi({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <Card className="p-3">
      <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
        {label}
      </div>
      <div className="font-semibold text-lg text-ink mt-0.5 tabular-nums">
        {value}
      </div>
      {hint && <div className="text-xs text-ink-muted mt-0.5">{hint}</div>}
    </Card>
  );
}

export default function LoanDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Loan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setData(await api.get<Loan>(`/loans/${params.id}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function recordRepayment(inst: Schedule) {
    const date = prompt(
      `Payment date for installment ${inst.installmentNo} (YYYY-MM-DD):`,
      inst.dueDate.slice(0, 10),
    );
    if (!date) return;
    const mode = prompt("Mode (Cash/Bank/UPI/Card):", "Bank");
    if (!mode) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/loans/${params.id}/record-repayment`, {
        installmentNo: inst.installmentNo,
        paymentDate: new Date(date).toISOString(),
        modeOfPayment: mode,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[{ label: "Loans", href: "/hr/loans" }]}
          title="Loan"
        />
        <Card className="p-4 text-red-700 border-red-200 bg-red-50">{error}</Card>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[{ label: "Loans", href: "/hr/loans" }]}
          title="Loading…"
        />
        <div className="grid grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20" rounded="rounded-lg" />
          ))}
        </div>
      </main>
    );
  }

  const paidInstallments = data.schedule.filter((s) => s.isPaid).length;
  const totalPrincipal = data.schedule.reduce(
    (s, i) => s + Number(i.principalAmount),
    0,
  );
  const totalInterest = data.schedule.reduce(
    (s, i) => s + Number(i.interestAmount),
    0,
  );

  const cols: Column<Schedule>[] = [
    {
      header: "#",
      cell: (s) => <span className="font-mono">{s.installmentNo}</span>,
      width: "60px",
    },
    { header: "Due date", cell: (s) => dateShort(s.dueDate) },
    {
      header: "Principal",
      align: "right",
      cell: (s) => (
        <span className="tabular-nums font-mono">
          {money(Number(s.principalAmount))}
        </span>
      ),
    },
    {
      header: "Interest",
      align: "right",
      cell: (s) => (
        <span className="tabular-nums font-mono">
          {money(Number(s.interestAmount))}
        </span>
      ),
    },
    {
      header: "EMI",
      align: "right",
      cell: (s) => (
        <span className="tabular-nums font-mono">
          {money(Number(s.totalAmount))}
        </span>
      ),
    },
    {
      header: "Balance after",
      align: "right",
      cell: (s) => (
        <span className="tabular-nums font-mono">
          {money(Number(s.balanceAfter))}
        </span>
      ),
    },
    {
      header: "Paid",
      cell: (s) =>
        s.isPaid ? (
          <span className="badge-green">
            {s.paidAt ? dateShort(s.paidAt) : "paid"}
          </span>
        ) : (
          <span className="text-ink-muted">—</span>
        ),
    },
    {
      header: "",
      align: "right",
      cell: (s) =>
        !s.isPaid && data.status === "Disbursed" ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => recordRepayment(s)}
            disabled={busy}
            type="button"
          >
            Record…
          </Button>
        ) : null,
    },
  ];

  const subtitle = (
    <span className="flex items-center gap-2">
      <StatusBadge status={data.status} />
      <a
        href={`/hr/employees/${data.employee.id}`}
        className="text-brand-600 hover:underline"
      >
        {data.employee.employeeName}
      </a>
      <span className="text-ink-muted font-mono text-xs">
        {data.employee.employeeCode}
      </span>
      <span className="text-ink-muted">· {data.loanType.loanTypeName}</span>
    </span>
  );

  return (
    <main className="p-8 space-y-6 max-w-5xl">
      <PageHeader
        breadcrumb={[
          { label: "Loans", href: "/hr/loans" },
          { label: data.name },
        ]}
        title={data.name}
        subtitle={subtitle}
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => history.back()}
              type="button"
            >
              ← Back
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                downloadPdf(`/print/loans/${data.id}`, `${data.name}.pdf`).catch(
                  (e) => showToast(e instanceof Error ? e.message : "PDF failed", "error"),
                )
              }
              type="button"
            >
              PDF
            </Button>
          </>
        }
      />

      <section className="grid grid-cols-4 gap-3">
        <Kpi label="Principal" value={money(Number(data.principal))} />
        <Kpi
          label="Interest rate / EMI"
          value={`${Number(data.interestRate).toFixed(2)}%`}
          hint={
            <span className="font-mono">
              EMI {money(Number(data.emi))} × {data.termMonths}
            </span>
          }
        />
        <Kpi label="Outstanding" value={money(Number(data.outstanding))} />
        <Kpi
          label="Paid"
          value={`${paidInstallments} / ${data.termMonths}`}
          hint={
            data.disbursementDate
              ? `Disbursed ${dateShort(data.disbursementDate)}`
              : "not yet disbursed"
          }
        />
      </section>

      <section>
        <SectionHeader title="Amortization schedule" />
        {data.schedule.length === 0 ? (
          <Card className="p-6 text-center text-ink-muted text-sm">
            No schedule yet — disburse the loan to generate one.
          </Card>
        ) : (
          <>
            <div className="hidden md:block">
              <DataTable<Schedule>
                columns={cols}
                rows={data.schedule}
                rowKey={(s) => s.id}
                empty={{
                  title: "No amortization schedule yet",
                  description: "The repayment schedule appears once the loan is disbursed and the first EMI date is set.",
                }}
              />
            </div>
            <ul className="md:hidden divide-y divide-line rounded-xl border border-ink/10 bg-canvas overflow-hidden">
              {data.schedule.map((s) => (
                <li key={s.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-ink">#{s.installmentNo}</div>
                      <div className="text-xs text-ink-muted">Due {dateShort(s.dueDate)}</div>
                    </div>
                    <div className="text-end">
                      <div className="font-mono text-ink tabular-nums">{Number(s.totalAmount).toFixed(2)}</div>
                      <div className="text-xs text-ink-muted tabular-nums">
                        P {Number(s.principalAmount).toFixed(2)} + I {Number(s.interestAmount).toFixed(2)}
                      </div>
                    </div>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-xs">
                    <span className={s.isPaid ? "text-green-700" : "text-ink-muted"}>
                      {s.isPaid ? `Paid${s.paidAt ? ` · ${dateShort(s.paidAt)}` : ""}` : "Pending"}
                    </span>
                    <span className="text-ink-muted tabular-nums">
                      Balance {Number(s.balanceAfter).toFixed(2)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-2 text-xs text-ink-muted flex justify-end gap-6 font-mono tabular-nums">
              <span>
                Total principal: <strong>{money(totalPrincipal)}</strong>
              </span>
              <span>
                Total interest: <strong>{money(totalInterest)}</strong>
              </span>
              <span>
                Total:{" "}
                <strong>{money(totalPrincipal + totalInterest)}</strong>
              </span>
            </div>
          </>
        )}
      </section>

      {data.remarks && (
        <Card className="p-4">
          <SectionHeader title="Remarks" />
          <div className="whitespace-pre-wrap text-sm">{data.remarks}</div>
        </Card>
      )}

      <section className="grid grid-cols-2 gap-4">
        <AttachmentsPanel doctype="Loan" docId={data.id} />
        <CommentsPanel
          doctype="Loan"
          docId={data.id}
          currentUserId={currentUserId()}
        />
      </section>
    </main>
  );
}
