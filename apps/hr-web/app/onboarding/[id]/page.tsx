"use client";

import { useEffect, useState } from "react";
import { DocActivityPanel } from "@lumaara/web-ui";
import { useParams } from "next/navigation";
import { api } from "../../../lib/api";
import {
  Button,
  Card,
  PageHeader,
  SectionHeader,
  Skeleton,
  StatusBadge,
} from "../../../components/ui";

interface Activity {
  id: string;
  activity: string;
  description: string | null;
  role: string | null;
  sortOrder: number;
  isComplete: boolean;
  completedBy: string | null;
  completedAt: string | null;
}
interface Checklist {
  id: string;
  name: string;
  type: string;
  status: string;
  startDate: string;
  targetDate: string | null;
  notes: string | null;
  employee: { id: string; employeeCode: string; employeeName: string; status: string };
  template: { id: string; name: string } | null;
  activities: Activity[];
}

export default function ChecklistDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Checklist | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setData(await api.get<Checklist>(`/employee-checklists/${params.id}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function toggle(activity: Activity) {
    setBusy(true);
    setError(null);
    try {
      const path = activity.isComplete
        ? `/employee-checklists/${params.id}/activities/${activity.id}/reopen`
        : `/employee-checklists/${params.id}/activities/${activity.id}/complete`;
      await api.post(path, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!confirm("Cancel this checklist?")) return;
    setBusy(true);
    try {
      await api.post(`/employee-checklists/${params.id}/cancel`, {});
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
            { label: "Onboarding & Separation", href: "/hr/onboarding" },
          ]}
          title="Checklist"
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
            { label: "Onboarding & Separation", href: "/hr/onboarding" },
          ]}
          title="Loading…"
        />
        <Skeleton className="h-32" rounded="rounded-lg" />
      </main>
    );
  }

  const done = data.activities.filter((a) => a.isComplete).length;
  const pct =
    data.activities.length > 0
      ? Math.round((done / data.activities.length) * 100)
      : 0;

  const subtitle = (
    <span className="flex items-center gap-2">
      <StatusBadge status={data.status} />
      <span className="text-ink-muted">{data.type}</span>
      <span className="text-ink-muted/60">·</span>
      <a
        href={`/hr/employees/${data.employee.id}`}
        className="text-brand-600 hover:underline"
      >
        {data.employee.employeeCode} — {data.employee.employeeName}
      </a>
    </span>
  );

  return (
    <main className="p-8 space-y-6 max-w-3xl">
      <PageHeader
        breadcrumb={[
          { label: "Onboarding & Separation", href: "/hr/onboarding" },
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
            {data.status === "InProgress" && (
              <Button variant="danger" onClick={cancel} type="button">
                Cancel checklist
              </Button>
            )}
          </>
        }
      />

      <Card className="p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-medium text-ink">Progress</div>
          <div className="text-sm text-ink-muted tabular-nums">
            {done} / {data.activities.length} ({pct}%)
          </div>
        </div>
        <div className="h-3 bg-surface-sunken rounded-full overflow-hidden">
          <div
            className={`h-full transition-all ${
              data.status === "Completed" ? "bg-green-500" : "bg-brand-600"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </Card>

      <Card className="p-0">
        <div className="divide-y divide-ink-muted/10">
          {data.activities.map((a) => (
            <div key={a.id} className="p-4 flex items-start gap-3">
              <input
                type="checkbox"
                checked={a.isComplete}
                disabled={busy || data.status === "Cancelled"}
                onChange={() => toggle(a)}
                className="mt-1 h-4 w-4"
              />
              <div className="flex-1">
                <div
                  className={`font-medium ${a.isComplete ? "line-through text-ink-muted" : "text-ink"}`}
                >
                  {a.activity}
                </div>
                {a.description && (
                  <div className="text-xs text-ink-muted mt-1">
                    {a.description}
                  </div>
                )}
                {a.role && (
                  <div className="text-xs text-ink-muted mt-1">
                    Owner role: <span className="font-medium">{a.role}</span>
                  </div>
                )}
                {a.completedAt && (
                  <div className="text-xs text-ink-muted mt-1">
                    Completed {new Date(a.completedAt).toLocaleString()}
                  </div>
                )}
              </div>
            </div>
          ))}
          {data.activities.length === 0 && (
            <div className="p-4 text-center text-ink-muted">No activities</div>
          )}
        </div>
      </Card>

      {data.notes && (
        <Card className="p-4">
          <SectionHeader title="Notes" />
          <div className="whitespace-pre-wrap text-sm">{data.notes}</div>
        </Card>
      )}
    
      <div className="rounded-xl border border-ink/10 bg-canvas p-4 mt-6">
        <h3 className="text-sm font-semibold text-ink mb-3">Activity</h3>
        <DocActivityPanel doctype="Onboarding" docId={params.id} />
      </div>
</main>
  );
}
