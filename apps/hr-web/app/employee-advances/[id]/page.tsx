"use client";

import { useEffect, useState } from "react";
import { DocActivityPanel } from "@lumaara/web-ui";
import { useParams } from "next/navigation";
import { api } from "../../../lib/api";
import {
  Button,
  Card,
  Field,
  PageHeader,
  SectionHeader,
  Skeleton,
  StatusBadge,
  dateShort,
  money,
} from "../../../components/ui";

interface Advance {
  id: string;
  name: string;
  postingDate: string;
  purpose: string;
  advanceAmount: string;
  paidAmount: string;
  returnAmount: string;
  status: string;
  modeOfPayment: string;
  remarks: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  employee: { id: string; employeeCode: string; employeeName: string };
  advanceAccount: { id: string; accountName: string } | null;
}

function Kpi({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Card className="p-3">
      <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
        {label}
      </div>
      <div className="font-semibold text-2xl mt-0.5 tabular-nums">{value}</div>
    </Card>
  );
}

export default function EmployeeAdvanceDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Advance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setData(await api.get<Advance>(`/employee-advances/${params.id}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function act(path: string, confirmMsg?: string) {
    if (confirmMsg && !confirm(confirmMsg)) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/employee-advances/${params.id}/${path}`, {});
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
          breadcrumb={[
            { label: "Employee Advances", href: "/hr/employee-advances" },
          ]}
          title="Employee Advance"
        />
        <Card className="p-4 text-red-700 border-red-200 bg-red-50">{error}</Card>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[
            { label: "Employee Advances", href: "/hr/employee-advances" },
          ]}
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

  const subtitle = (
    <span className="flex items-center gap-2">
      <StatusBadge status={data.status} />
      <a
        href={`/hr/employees/${data.employee.id}`}
        className="text-brand-600 hover:underline"
      >
        {data.employee.employeeCode} — {data.employee.employeeName}
      </a>
      <span className="text-ink-muted">· {dateShort(data.postingDate)}</span>
    </span>
  );

  return (
    <main className="p-8 space-y-6 max-w-4xl">
      <PageHeader
        breadcrumb={[
          { label: "Employee Advances", href: "/hr/employee-advances" },
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
              <Button
                variant="primary"
                onClick={() => act("approve")}
                disabled={busy}
                type="button"
              >
                Approve
              </Button>
            )}
            {data.status === "Approved" && (
              <Button
                variant="primary"
                onClick={() => act("pay", "Pay out this advance? Will post GL.")}
                disabled={busy}
                type="button"
              >
                Pay Out
              </Button>
            )}
            {data.status !== "Cancelled" && (
              <Button
                variant="danger"
                onClick={() => act("cancel", "Cancel this advance?")}
                disabled={busy}
                type="button"
              >
                Cancel
              </Button>
            )}
          </>
        }
      />

      <section className="grid grid-cols-3 gap-3">
        <Kpi label="Amount" value={money(Number(data.advanceAmount))} />
        <Kpi label="Paid" value={money(Number(data.paidAmount))} />
        <Kpi label="Returned" value={money(Number(data.returnAmount))} />
      </section>

      <Card className="p-4">
        <SectionHeader title="Details" />
        <div className="grid grid-cols-2 gap-4">
          <Field label="Purpose" value={data.purpose} />
          <Field label="Mode of payment" value={data.modeOfPayment} />
          {data.advanceAccount && (
            <Field
              label="Advance account"
              value={data.advanceAccount.accountName}
            />
          )}
          {data.approvedAt && (
            <Field
              label="Approved at"
              value={new Date(data.approvedAt).toLocaleString()}
            />
          )}
        </div>
        {data.remarks && (
          <div className="mt-4">
            <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
              Remarks
            </div>
            <div className="mt-1 whitespace-pre-wrap text-sm">{data.remarks}</div>
          </div>
        )}
      </Card>
    
      <div className="rounded-xl border border-ink/10 bg-canvas p-4 mt-6">
        <h3 className="text-sm font-semibold text-ink mb-3">Activity</h3>
        <DocActivityPanel doctype="EmployeeAdvance" docId={params.id} />
      </div>
</main>
  );
}
