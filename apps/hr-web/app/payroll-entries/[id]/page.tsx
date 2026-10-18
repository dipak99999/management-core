"use client";

import { useEffect, useState } from "react";
import { DocActivityPanel } from "@lumaara/web-ui";
import { showToast } from "../../../lib/toast";
import { useParams } from "next/navigation";
import { api, downloadFile } from "../../../lib/api";
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

interface Row {
  id: string;
  employeeId: string;
  employee: { employeeCode: string; employeeName: string };
  salarySlip: { id: string; name: string; status: string } | null;
  gross: string;
  deduction: string;
  net: string;
}

interface Entry {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  postingDate: string;
  department: string | null;
  designation: string | null;
  paymentMode: string;
  status: string;
  totalGross: string;
  totalDeduction: string;
  totalNet: string;
  slipsCount: number;
  payoutJournalEntryId: string | null;
  employees: Row[];
}

function Kpi({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Card className="p-3">
      <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
        {label}
      </div>
      <div className="font-semibold text-lg text-ink mt-0.5 tabular-nums">{value}</div>
    </Card>
  );
}

export default function PayrollEntryDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Entry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setData(await api.get<Entry>(`/payroll-entries/${params.id}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function submit() {
    if (!confirm("Submit payroll: generate + submit all slips + post payout JE?")) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/payroll-entries/${params.id}/submit`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!confirm("Cancel payroll: reverses payout JE + all slips?")) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/payroll-entries/${params.id}/cancel`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function del() {
    if (!confirm("Delete draft payroll entry?")) return;
    try {
      await api.del(`/payroll-entries/${params.id}`);
      window.location.href = "/hr/payroll-entries";
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  async function downloadAdvice(format: "Generic" | "HDFC" | "SBI" | "ICICI" | "Axis" | "YesBank") {
    try {
      const { skipped } = await downloadFile(
        `/payroll-entries/${params.id}/bank-advice?format=${format}`,
        `bank-advice-${format.toLowerCase()}.csv`,
      );
      if (skipped > 0) {
        showToast(
          `${skipped} employee${skipped === 1 ? " was" : "s were"} skipped — missing bank account or invalid IFSC. Fix on their employee profile.`,
          "info",
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed");
    }
  }

  if (error) {
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[{ label: "Payroll Entries", href: "/hr/payroll-entries" }]}
          title="Payroll Entry"
        />
        <Card className="p-4 text-red-700 border-red-200 bg-red-50">{error}</Card>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[{ label: "Payroll Entries", href: "/hr/payroll-entries" }]}
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

  const cols: Column<Row>[] = [
    {
      header: "Code",
      cell: (r) => (
        <span className="font-mono text-xs">{r.employee.employeeCode}</span>
      ),
    },
    { header: "Name", cell: (r) => r.employee.employeeName },
    {
      header: "Gross",
      align: "right",
      cell: (r) => <span className="tabular-nums">{money(Number(r.gross))}</span>,
    },
    {
      header: "Deduction",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums">{money(Number(r.deduction))}</span>
      ),
    },
    {
      header: "Net",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums font-semibold">{money(Number(r.net))}</span>
      ),
    },
    {
      header: "Slip",
      cell: (r) =>
        r.salarySlip ? (
          <a
            href={`/hr/salary-slips/${r.salarySlip.id}`}
            className="text-brand-600 font-mono text-xs hover:underline"
          >
            {r.salarySlip.name}
          </a>
        ) : (
          <span className="text-xs text-ink-muted">—</span>
        ),
    },
  ];

  const subtitle = (
    <span className="flex items-center gap-2">
      <StatusBadge status={data.status} />
      <span className="text-ink-muted">
        {dateShort(data.startDate)} → {dateShort(data.endDate)} · Payout via{" "}
        {data.paymentMode}
      </span>
    </span>
  );

  return (
    <main className="p-8 space-y-6">
      <PageHeader
        breadcrumb={[
          { label: "Payroll Entries", href: "/hr/payroll-entries" },
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
            {data.status === "Draft" && (
              <>
                <Button
                  variant="primary"
                  onClick={submit}
                  disabled={busy}
                  type="button"
                >
                  Submit + Generate Slips
                </Button>
                <Button variant="danger" onClick={del} type="button">
                  Delete
                </Button>
              </>
            )}
            {data.status === "Submitted" && (
              <>
                <Button variant="secondary" onClick={() => downloadAdvice("Generic")} type="button">
                  Bank advice · Generic
                </Button>
                <Button variant="secondary" onClick={() => downloadAdvice("HDFC")} type="button">
                  HDFC
                </Button>
                <Button variant="secondary" onClick={() => downloadAdvice("SBI")} type="button">
                  SBI
                </Button>
                <Button variant="secondary" onClick={() => downloadAdvice("ICICI")} type="button">
                  ICICI
                </Button>
                <Button variant="secondary" onClick={() => downloadAdvice("Axis")} type="button">
                  Axis
                </Button>
                <Button variant="secondary" onClick={() => downloadAdvice("YesBank")} type="button">
                  Yes Bank
                </Button>
                <Button
                  variant="danger"
                  onClick={cancel}
                  disabled={busy}
                  type="button"
                >
                  Cancel
                </Button>
              </>
            )}
          </>
        }
      />

      <section className="grid grid-cols-4 gap-3">
        <Kpi label="Slips" value={data.slipsCount} />
        <Kpi label="Gross" value={money(Number(data.totalGross))} />
        <Kpi label="Deductions" value={money(Number(data.totalDeduction))} />
        <Kpi label="Net Paid" value={money(Number(data.totalNet))} />
      </section>

      <section>
        <SectionHeader title={`Employees (${data.employees.length})`} />
        <div className="hidden md:block">
          <DataTable<Row>
            columns={cols}
            rows={data.employees}
            rowKey={(r) => r.id}
            empty={{ title: "No employees selected yet" }}
          />
        </div>
        {data.employees.length === 0 ? (
          <div className="md:hidden rounded-xl border border-ink/10 bg-canvas px-4 py-6 text-center text-sm text-ink-muted">
            No employees selected yet
          </div>
        ) : (
          <ul className="md:hidden divide-y divide-line rounded-xl border border-ink/10 bg-canvas overflow-hidden">
            {data.employees.map((r) => (
              <li key={r.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-ink truncate">{r.employee.employeeName}</div>
                    <div className="text-xs text-ink-muted font-mono truncate">{r.employee.employeeCode}</div>
                  </div>
                  <div className="text-end">
                    <div className="font-mono text-ink tabular-nums">{Number(r.net).toFixed(2)}</div>
                    <div className="text-xs text-ink-muted tabular-nums">
                      {Number(r.gross).toFixed(2)} − {Number(r.deduction).toFixed(2)}
                    </div>
                  </div>
                </div>
                {r.salarySlip && (
                  <div className="mt-1 text-xs">
                    <a href={`/hr/salary-slips/${r.salarySlip.id}`} className="font-mono text-brand-600 hover:underline">
                      {r.salarySlip.name}
                    </a>
                    <span className="text-ink-muted"> · {r.salarySlip.status}</span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.payoutJournalEntryId && (
        <Card className="p-3 text-xs text-ink-muted">
          Consolidated payout posted as Journal Entry:{" "}
          <a
            href={`/accounting/journal-entries/${data.payoutJournalEntryId}`}
            className="text-brand-600 hover:underline font-mono"
          >
            {data.payoutJournalEntryId}
          </a>
        </Card>
      )}
    
      <div className="rounded-xl border border-ink/10 bg-canvas p-4 mt-6">
        <h3 className="text-sm font-semibold text-ink mb-3">Activity</h3>
        <DocActivityPanel doctype="PayrollEntry" docId={params.id} />
      </div>
</main>
  );
}
