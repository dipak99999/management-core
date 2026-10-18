"use client";

import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import {
  Card,
  DataTable,
  PageHeader,
  SectionHeader,
  Skeleton,
  dateShort,
  money,
  type Column,
} from "../../components/ui";

interface Dashboard {
  headcount: Record<string, number>;
  byDepartment: { department: string; count: number }[];
  onLeave: number;
  mtdPayroll: { gross: number; deduction: number; net: number };
  loans: { activeCount: number; outstanding: number };
  pending: {
    expenseClaims: number;
    expenseClaimsAmount: number;
    leaveApplications: number;
    onboarding: number;
    jobOpenings: number;
  };
  expiringCertifications: {
    id: string;
    certificationName: string;
    expiryDate: string;
    employee: { employeeCode: string; employeeName: string };
  }[];
  recentHires: {
    id: string;
    employeeCode: string;
    employeeName: string;
    dateOfJoining: string | null;
    department: string | null;
  }[];
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
      <div className="font-semibold text-2xl text-ink mt-0.5 tabular-nums">
        {value}
      </div>
      {hint && <div className="text-xs text-ink-muted mt-1">{hint}</div>}
    </Card>
  );
}

export default function HRDashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setData(await api.get<Dashboard>("/reports/hr-dashboard"));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed");
      }
    })();
  }, []);

  if (error) {
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[{ label: "HR & Payroll", href: "/hr" }, { label: "Dashboard" }]}
          title="HR Dashboard"
        />
        <Card className="p-4 text-red-700 border-red-200 bg-red-50">{error}</Card>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[{ label: "HR & Payroll", href: "/hr" }, { label: "Dashboard" }]}
          title="Loading…"
        />
        <div className="grid grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" rounded="rounded-lg" />
          ))}
        </div>
      </main>
    );
  }

  const activeCount = data.headcount.Active ?? 0;

  const certCols: Column<Dashboard["expiringCertifications"][0]>[] = [
    {
      header: "Employee",
      cell: (c) => (
        <span>
          <span className="font-mono text-xs text-ink-muted">
            {c.employee.employeeCode}
          </span>{" "}
          {c.employee.employeeName}
        </span>
      ),
    },
    { header: "Certification", cell: (c) => c.certificationName },
    {
      header: "Expires",
      align: "right",
      cell: (c) => (
        <span className="text-amber-700 font-medium">
          {dateShort(c.expiryDate)}
        </span>
      ),
    },
  ];

  return (
    <main className="p-8 space-y-6 max-w-6xl">
      <PageHeader
        breadcrumb={[{ label: "HR & Payroll", href: "/hr" }, { label: "Dashboard" }]}
        title="HR Dashboard"
        subtitle="At-a-glance KPIs across headcount, payroll, and pipeline"
      />

      <section className="grid grid-cols-4 gap-3">
        <Kpi label="Active headcount" value={activeCount} />
        <Kpi
          label="On leave"
          value={data.onLeave}
          hint={`of ${activeCount} active`}
        />
        <Kpi
          label="MTD payroll (net)"
          value={money(data.mtdPayroll.net)}
          hint={`Gross ${money(data.mtdPayroll.gross)}`}
        />
        <Kpi
          label="Loans outstanding"
          value={money(data.loans.outstanding)}
          hint={`${data.loans.activeCount} active`}
        />
      </section>

      <section className="grid grid-cols-5 gap-3">
        <Kpi label="Pending leave apps" value={data.pending.leaveApplications} />
        <Kpi
          label="Pending expense claims"
          value={data.pending.expenseClaims}
          hint={money(data.pending.expenseClaimsAmount)}
        />
        <Kpi label="Onboarding in progress" value={data.pending.onboarding} />
        <Kpi label="Open job openings" value={data.pending.jobOpenings} />
        <Kpi label="Certs expiring < 30d" value={data.expiringCertifications.length} />
      </section>

      <section className="grid grid-cols-2 gap-4">
        <Card className="p-4">
          <SectionHeader title="Active headcount by department" />
          <ul className="text-sm">
            {data.byDepartment.map((d) => (
              <li
                key={d.department}
                className="flex justify-between py-1 border-t border-ink-muted/10 first:border-t-0"
              >
                <span>{d.department}</span>
                <span className="font-medium tabular-nums">{d.count}</span>
              </li>
            ))}
            {data.byDepartment.length === 0 && (
              <li className="text-xs text-ink-muted">No active employees</li>
            )}
          </ul>
        </Card>

        <Card className="p-4">
          <SectionHeader title="Recent hires" />
          <ul className="text-sm">
            {data.recentHires.map((h) => (
              <li
                key={h.id}
                className="py-1 border-t border-ink-muted/10 first:border-t-0 flex justify-between"
              >
                <div>
                  <a
                    href={`/hr/employees/${h.id}`}
                    className="text-brand-600 hover:underline font-mono"
                  >
                    {h.employeeCode}
                  </a>{" "}
                  <span className="text-ink-soft">{h.employeeName}</span>
                </div>
                <div className="text-xs text-ink-muted">
                  {h.department ?? "—"}
                  {h.dateOfJoining && ` · ${dateShort(h.dateOfJoining)}`}
                </div>
              </li>
            ))}
            {data.recentHires.length === 0 && (
              <li className="text-xs text-ink-muted">No hires yet</li>
            )}
          </ul>
        </Card>
      </section>

      {data.expiringCertifications.length > 0 && (
        <section>
          <SectionHeader title="Certifications expiring soon" />
          <DataTable
            columns={certCols}
            rows={data.expiringCertifications}
            rowKey={(c) => c.id}
            empty={{
              title: "All certifications current",
              description: "No employee certifications expire in the next 30 days.",
            }}
          />
        </section>
      )}
    </main>
  );
}
