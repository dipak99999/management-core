"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "../../../lib/api";
import { trackRecent } from "../../../lib/recent";
import { WorkflowActions } from "../../../lib/workflow-actions";
import { CustomFieldsView } from "../../../lib/custom-fields";
import { AttachmentsPanel } from "../../../lib/attachments";
import { CommentsPanel } from "../../../lib/comments";
import { AiInsightCard } from "../../../components/ai-insight-card";
import { ActivityTimeline } from "../../../components/activity-timeline";
import { currentUserId } from "../../../lib/collab-api";
import {
  Button,
  Card,
  DataTable,
  Field,
  NotFoundState,
  PageHeader,
  SectionHeader,
  Skeleton,
  StatusBadge,
  dateShort,
  money,
  type Column,
} from "../../../components/ui";

interface Employee {
  id: string;
  employeeCode: string;
  employeeName: string;
  email: string | null;
  mobile: string | null;
  designation: string | null;
  department: string | null;
  dateOfJoining: string | null;
  baseSalary: string;
  bankAccountNo: string | null;
  status: string;
  customData: Record<string, unknown> | null;
}
interface SalarySlip {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  grossPay: string;
  totalDeduction: string;
  netPay: string;
  status: string;
}
interface Attendance {
  id: string;
  date: string;
  status: string;
  remarks: string | null;
}
interface Payload {
  employee: Employee;
  stats: {
    mtdGross: number;
    mtdNet: number;
    ytdGross: number;
    ytdNet: number;
    attendance30: Record<string, number>;
  };
  salarySlips: SalarySlip[];
  recentAttendance: Attendance[];
}

function Kpi({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: "success" | "danger" | "warn" | "muted";
}) {
  const toneCls =
    tone === "success"
      ? "text-green-700"
      : tone === "danger"
        ? "text-red-700"
        : tone === "warn"
          ? "text-amber-700"
          : "text-ink-muted";
  return (
    <Card className="p-3">
      <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
        {label}
      </div>
      <div className={`font-semibold text-lg mt-0.5 ${toneCls}`}>{value}</div>
      {hint && <div className="text-xs text-ink-muted mt-0.5">{hint}</div>}
    </Card>
  );
}

export default function EmployeeDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setData(await api.get<Payload>(`/employees/${params.id}/full`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);
  useEffect(() => {
    const emp = data?.employee;
    if (emp) {
      trackRecent({
        doctype: "Employee",
        id: emp.id,
        label: emp.employeeName,
        href: `/hr/employees/${emp.id}`,
      });
    }
  }, [data?.employee]);

  if (error) {
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[{ label: "Employees", href: "/hr/employees" }]}
          title="Employee"
        />
        {/not found/i.test(error) || /404/.test(error) ? (
          <NotFoundState doctype="Employee" listHref="/hr/employees" listLabel="Employees" />
        ) : (
          <Card className="p-4 text-red-700 border-red-200 bg-red-50">{error}</Card>
        )}
      </main>
    );
  }
  if (!data) {
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[{ label: "Employees", href: "/hr/employees" }]}
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

  const e = data.employee;
  const att = data.stats.attendance30;
  const present = (att["Present"] ?? 0) + (att["Work From Home"] ?? 0);
  const absent = att["Absent"] ?? 0;
  const halfDay = att["Half Day"] ?? 0;
  const onLeave = att["On Leave"] ?? 0;

  const subtitle = (
    <span className="flex items-center gap-2">
      <span className="font-mono">{e.employeeCode}</span>
      <span className="text-ink-muted/60">·</span>
      <span>{e.designation ?? "—"}</span>
      <span className="text-ink-muted/60">·</span>
      <span>{e.department ?? "—"}</span>
      <StatusBadge status={e.status} />
    </span>
  );

  const slipCols: Column<SalarySlip>[] = [
    {
      header: "Slip",
      cell: (s) => (
        <a
          href={`/hr/salary-slips/${s.id}`}
          className="font-mono text-brand-600 hover:underline"
        >
          {s.name}
        </a>
      ),
    },
    {
      header: "Period",
      cell: (s) => `${dateShort(s.startDate)} → ${dateShort(s.endDate)}`,
    },
    {
      header: "Gross",
      align: "right",
      cell: (s) => <span className="tabular-nums">{money(Number(s.grossPay))}</span>,
    },
    {
      header: "Deductions",
      align: "right",
      cell: (s) => (
        <span className="tabular-nums">{money(Number(s.totalDeduction))}</span>
      ),
    },
    {
      header: "Net",
      align: "right",
      cell: (s) => (
        <span className="tabular-nums font-semibold">
          {money(Number(s.netPay))}
        </span>
      ),
    },
    { header: "Status", cell: (s) => <StatusBadge status={s.status} /> },
  ];

  const attCols: Column<Attendance>[] = [
    { header: "Date", cell: (a) => dateShort(a.date) },
    { header: "Status", cell: (a) => <StatusBadge status={a.status} /> },
    { header: "Remarks", cell: (a) => a.remarks ?? "—" },
  ];

  return (
    <main className="p-8 space-y-6">
      <PageHeader
        breadcrumb={[
          { label: "Employees", href: "/hr/employees" },
          { label: e.employeeName },
        ]}
        title={e.employeeName}
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
            <a href={`/hr/employees?editId=${e.id}`}>
              <Button variant="primary" type="button">
                Edit
              </Button>
            </a>
          </>
        }
      />

      <WorkflowActions doctype="Employee" docId={e.id} onChange={load} />

      <AiInsightCard doctype="Employee" docId={e.id} />

      <ActivityTimeline parentType="Employee" parentId={e.id} />

      <section className="grid grid-cols-3 gap-3">
        <Card className="p-4">
          <SectionHeader title="Contact" />
          <div className="space-y-1 text-sm">
            {e.email && <div>{e.email}</div>}
            {e.mobile && <div className="text-ink-muted">{e.mobile}</div>}
            {e.dateOfJoining && (
              <div className="text-xs text-ink-muted mt-1">
                Joined {dateShort(e.dateOfJoining)}
              </div>
            )}
          </div>
        </Card>
        <Card className="p-4">
          <SectionHeader title="Base salary" />
          <div className="font-semibold text-2xl tabular-nums">
            {money(Number(e.baseSalary))}
          </div>
          <div className="text-xs text-ink-muted mt-1">monthly gross</div>
        </Card>
        <Card className="p-4">
          <SectionHeader title="Payroll paid" />
          <div className="flex justify-between text-sm">
            <span className="text-ink-muted">MTD</span>
            <span className="font-semibold tabular-nums">
              {money(data.stats.mtdNet)} / {money(data.stats.mtdGross)}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-ink-muted">YTD</span>
            <span className="font-semibold tabular-nums">
              {money(data.stats.ytdNet)} / {money(data.stats.ytdGross)}
            </span>
          </div>
          <div className="text-xs text-ink-muted mt-1">net / gross</div>
        </Card>
      </section>

      <CustomFieldsView doctype="Employee" data={e.customData} />

      <section>
        <SectionHeader title="Attendance (last 30 days)" />
        <div className="grid grid-cols-4 gap-3">
          <Kpi label="Present / WFH" value={present} tone="success" />
          <Kpi label="Absent" value={absent} tone="danger" />
          <Kpi label="Half Day" value={halfDay} tone="warn" />
          <Kpi label="On Leave" value={onLeave} tone="muted" />
        </div>
      </section>

      <section>
        <SectionHeader title="Salary slips (latest 24)" />
        <div className="hidden md:block">
          <DataTable<SalarySlip>
            columns={slipCols}
            rows={data.salarySlips}
            rowKey={(s) => s.id}
            empty={{ title: "No salary slips yet" }}
          />
        </div>
        {data.salarySlips.length === 0 ? (
          <div className="md:hidden rounded-xl border border-ink/10 bg-canvas px-4 py-6 text-center text-sm text-ink-muted">
            No salary slips yet
          </div>
        ) : (
          <ul className="md:hidden divide-y divide-line rounded-xl border border-ink/10 bg-canvas overflow-hidden">
            {data.salarySlips.map((s) => (
              <li key={s.id}>
                <a href={`/hr/salary-slips/${s.id}`} className="block px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-sm text-brand-600 truncate">{s.name}</div>
                      <div className="text-xs text-ink-muted">
                        {dateShort(s.startDate)} → {dateShort(s.endDate)}
                      </div>
                    </div>
                    <div className="text-end">
                      <div className="font-mono text-ink tabular-nums">
                        {Number(s.netPay).toFixed(2)}
                      </div>
                      <div className="text-xs text-ink-muted">{s.status}</div>
                    </div>
                  </div>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <SectionHeader title="Recent attendance (last 30 days)" />
        <div className="hidden md:block">
          <DataTable<Attendance>
            columns={attCols}
            rows={data.recentAttendance}
            rowKey={(a) => a.id}
            empty={{ title: "No attendance recorded" }}
          />
        </div>
        {data.recentAttendance.length === 0 ? (
          <div className="md:hidden rounded-xl border border-ink/10 bg-canvas px-4 py-6 text-center text-sm text-ink-muted">
            No attendance recorded
          </div>
        ) : (
          <ul className="md:hidden divide-y divide-line rounded-xl border border-ink/10 bg-canvas overflow-hidden">
            {data.recentAttendance.map((a) => (
              <li key={a.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-ink">{dateShort(a.date)}</div>
                    {a.remarks && <div className="text-xs text-ink-muted">{a.remarks}</div>}
                  </div>
                  <span className="text-xs text-ink-muted rounded bg-surface-sunken px-2 py-0.5">
                    {a.status}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {e.bankAccountNo && (
        <Card className="p-4">
          <SectionHeader title="Bank" />
          <Field label="Account" value={<span className="font-mono">{e.bankAccountNo}</span>} />
        </Card>
      )}

      <section className="grid grid-cols-2 gap-4">
        <AttachmentsPanel doctype="Employee" docId={e.id} />
        <CommentsPanel
          doctype="Employee"
          docId={e.id}
          currentUserId={currentUserId()}
        />
      </section>
    </main>
  );
}
