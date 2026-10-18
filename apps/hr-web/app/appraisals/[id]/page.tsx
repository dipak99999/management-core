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
  dateShort,
} from "../../../components/ui";

interface Goal {
  id: string;
  kra: string;
  description: string | null;
  weightPercent: string;
  score: string;
  weightedScore: string;
  sortOrder: number;
}

interface Appraisal {
  id: string;
  name: string;
  status: string;
  periodStart: string;
  periodEnd: string;
  finalScore: string;
  employeeRemarks: string | null;
  appraiserRemarks: string | null;
  submittedAt: string | null;
  employee: { id: string; employeeCode: string; employeeName: string };
  template: { id: string; name: string } | null;
  goals: Goal[];
}

export default function AppraisalDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Appraisal | null>(null);
  const [remarks, setRemarks] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const d = await api.get<Appraisal>(`/appraisals/${params.id}`);
      setData(d);
      setRemarks(d.appraiserRemarks ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function scoreGoal(goalId: string, score: number) {
    setBusy(true);
    try {
      const d = await api.post<Appraisal>(`/appraisals/${params.id}/score`, {
        goalId,
        score,
      });
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!confirm("Submit appraisal? This locks scores.")) return;
    setBusy(true);
    try {
      await api.post(`/appraisals/${params.id}/submit`, {
        appraiserRemarks: remarks || null,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!confirm("Cancel this appraisal?")) return;
    setBusy(true);
    try {
      await api.post(`/appraisals/${params.id}/cancel`, {});
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
          breadcrumb={[{ label: "Appraisals", href: "/hr/appraisals" }]}
          title="Appraisal"
        />
        <Card className="p-4 text-red-700 border-red-200 bg-red-50">{error}</Card>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[{ label: "Appraisals", href: "/hr/appraisals" }]}
          title="Loading…"
        />
        <Skeleton className="h-40" rounded="rounded-lg" />
      </main>
    );
  }

  const readOnly = data.status !== "Draft";
  const subtitle = (
    <span className="flex items-center gap-2">
      <StatusBadge status={data.status} />
      <a
        href={`/hr/employees/${data.employee.id}`}
        className="text-brand-600 hover:underline"
      >
        {data.employee.employeeCode} — {data.employee.employeeName}
      </a>
      <span className="text-ink-muted">
        · {dateShort(data.periodStart)} → {dateShort(data.periodEnd)}
      </span>
    </span>
  );

  return (
    <main className="p-8 space-y-6 max-w-4xl">
      <PageHeader
        breadcrumb={[
          { label: "Appraisals", href: "/hr/appraisals" },
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
                  Submit &amp; Lock
                </Button>
                <Button variant="danger" onClick={cancel} type="button">
                  Cancel
                </Button>
              </>
            )}
          </>
        }
      />

      <Card className="p-4 flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
          Final score
        </div>
        <div className="text-3xl font-semibold tabular-nums">
          {Number(data.finalScore).toFixed(2)}
          <span className="text-lg text-ink-muted"> / 5</span>
        </div>
      </Card>

      <Card className="p-0">
        <div className="px-4 pt-3">
          <SectionHeader title="Goals" />
        </div>
        <div className="divide-y divide-ink-muted/10">
          {data.goals.map((g) => (
            <div key={g.id} className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="font-medium text-ink">
                    {g.kra}{" "}
                    <span className="text-xs text-ink-muted">
                      · weight {Number(g.weightPercent).toFixed(1)}%
                    </span>
                  </div>
                  {g.description && (
                    <div className="text-sm text-ink-muted mt-1">
                      {g.description}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex gap-1">
                    {[0, 1, 2, 3, 4, 5].map((s) => {
                      const active = Number(g.score) === s;
                      return (
                        <button
                          key={s}
                          disabled={readOnly || busy}
                          onClick={() => scoreGoal(g.id, s)}
                          className={`w-8 h-8 rounded-full text-sm font-medium transition ${
                            active
                              ? "bg-brand-600 text-white"
                              : "bg-surface-sunken text-ink-soft hover:bg-brand-50"
                          } disabled:opacity-50`}
                        >
                          {s}
                        </button>
                      );
                    })}
                  </div>
                  <div className="text-xs text-ink-muted min-w-[3.5rem] text-end tabular-nums">
                    = {Number(g.weightedScore).toFixed(2)}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {data.employeeRemarks && (
        <Card className="p-4">
          <SectionHeader title="Employee remarks" />
          <div className="whitespace-pre-wrap text-sm">{data.employeeRemarks}</div>
        </Card>
      )}

      <Card className="p-4 space-y-2">
        <SectionHeader title="Appraiser remarks" />
        <textarea
          className="input"
          disabled={readOnly}
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          rows={3}
        />
      </Card>

      {data.status === "Completed" && data.submittedAt && (
        <div className="text-xs text-ink-muted">
          Submitted {new Date(data.submittedAt).toLocaleString()}
        </div>
      )}
    
      <div className="rounded-xl border border-ink/10 bg-canvas p-4 mt-6">
        <h3 className="text-sm font-semibold text-ink mb-3">Activity</h3>
        <DocActivityPanel doctype="Appraisal" docId={params.id} />
      </div>
</main>
  );
}
