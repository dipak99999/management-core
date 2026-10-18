"use client";

import { useEffect, useState } from "react";
import { DocActivityPanel } from "@lumaara/web-ui";
import { useParams } from "next/navigation";
import { dashboardApi } from "../../../../lib/dashboards";
import { AppShell } from "../../../../components/app-shell";
import { SHELL_NAV } from "../../../../components/shell-nav";
import {
  Button,
  Card,
  DataTable,
  PageHeader,
  SectionHeader,
  Skeleton,
  StatusBadge,
  dateShort,
  type Column,
} from "../../../../components/ui";

interface JobRow {
  id: string;
  rowNumber: number;
  status: string;
  action: string | null;
  targetId: string | null;
  errorMessage: string | null;
  rawJson: Record<string, string>;
}

interface Job {
  id: string;
  name: string;
  doctype: string;
  mode: string;
  keyField: string | null;
  dryRun: boolean;
  status: string;
  totalRows: number;
  succeededRows: number;
  failedRows: number;
  startedAt: string | null;
  finishedAt: string | null;
  rows: JobRow[];
}

const TERMINAL = new Set(["Completed", "Failed", "Cancelled"]);

export default function ImportJobDetailPage() {
  const params = useParams<{ id: string }>();
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      try {
        const next = await dashboardApi.get<Job>(`/imports/${params.id}`);
        if (cancelled) return;
        setJob(next);
        // Keep polling while the worker is still running. 2s is a fine cadence
        // for the imports queue — most jobs finish in well under a minute.
        if (!TERMINAL.has(next.status)) {
          timer = setTimeout(tick, 2000);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed");
      }
    }

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [params.id]);

  const breadcrumb = [
    { label: "Admin", href: "/admin" },
    { label: "Imports", href: "/admin/imports" },
    { label: job?.name ?? "Import job" },
  ];

  if (error && !job) {
    return (
      <AppShell moduleName="Home" nav={SHELL_NAV}>
        <PageHeader
          breadcrumb={breadcrumb}
          title="Import job"
          actions={
            <Button variant="secondary" onClick={() => history.back()} type="button">
              ← Back
            </Button>
          }
        />
        <Card className="p-4 text-red-700 border-red-200 bg-red-50">{error}</Card>
      </AppShell>
    );
  }

  if (!job) {
    return (
      <AppShell moduleName="Home" nav={SHELL_NAV}>
        <PageHeader breadcrumb={breadcrumb} title="Loading…" />
        <div className="space-y-3">
          <Skeleton className="h-20" rounded="rounded-lg" />
          <Skeleton className="h-64" rounded="rounded-lg" />
        </div>
      </AppShell>
    );
  }

  const columns: Column<JobRow>[] = [
    {
      header: "#",
      width: "56px",
      align: "right",
      cell: (r) => <span className="tabular-nums text-ink-muted">{r.rowNumber}</span>,
    },
    { header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
    {
      header: "Action",
      cell: (r) => <span className="text-ink-soft">{r.action ?? "—"}</span>,
    },
    {
      header: "Target",
      cell: (r) => (
        <span className="font-mono text-xs text-ink-soft">{r.targetId ?? "—"}</span>
      ),
    },
    {
      header: "Error",
      cell: (r) => (
        <span className={r.errorMessage ? "text-red-700" : "text-ink-muted"}>
          {r.errorMessage ?? "—"}
        </span>
      ),
    },
    {
      header: "Raw",
      cell: (r) => (
        <span className="text-xs text-ink-muted">
          {Object.entries(r.rawJson)
            .slice(0, 3)
            .map(([k, v]) => `${k}=${v}`)
            .join(" · ")}
        </span>
      ),
    },
  ];

  return (
    <AppShell moduleName="Home" nav={SHELL_NAV}>
      <PageHeader
        breadcrumb={breadcrumb}
        title={job.name}
        subtitle={
          <span className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={job.status} />
            <span className="text-ink-muted">·</span>
            <span className="font-mono">{job.doctype}</span>
            <span className="text-ink-muted">·</span>
            <span>{job.mode}</span>
            {job.dryRun && (
              <>
                <span className="text-ink-muted">·</span>
                <span className="badge-amber">dry-run</span>
              </>
            )}
            <span className="text-ink-muted">·</span>
            <span className="tabular-nums text-emerald-700">
              {job.succeededRows}/{job.totalRows} succeeded
            </span>
            {job.failedRows > 0 && (
              <>
                <span className="text-ink-muted">·</span>
                <span className="tabular-nums text-red-700">
                  {job.failedRows} failed
                </span>
              </>
            )}
            {job.finishedAt && (
              <>
                <span className="text-ink-muted">·</span>
                <span>Finished {dateShort(job.finishedAt)}</span>
              </>
            )}
          </span>
        }
        actions={
          <Button variant="secondary" onClick={() => history.back()} type="button">
            ← Back
          </Button>
        }
      />

      <div className="max-w-6xl">
        <SectionHeader title="Row results" />
        <div className="hidden md:block">
          <DataTable
            columns={columns}
            rows={job.rows}
            rowKey={(r) => r.id}
            empty={{ title: "No rows" }}
          />
        </div>
        {job.rows.length === 0 ? (
          <div className="md:hidden rounded-xl border border-ink/10 bg-canvas px-4 py-6 text-center text-sm text-ink-muted">
            No rows
          </div>
        ) : (
          <ul className="md:hidden divide-y divide-line rounded-xl border border-ink/10 bg-canvas overflow-hidden">
            {job.rows.map((r) => (
              <li key={r.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-sm text-ink">Row {r.rowNumber}</div>
                    {r.action && <div className="text-xs text-ink-muted">{r.action}</div>}
                  </div>
                  <span className="text-xs text-ink-muted rounded bg-surface-sunken px-2 py-0.5">
                    {r.status}
                  </span>
                </div>
                {r.errorMessage && (
                  <div className="mt-1 text-xs text-red-600">{r.errorMessage}</div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    
      <div className="rounded-xl border border-ink/10 bg-canvas p-4 mt-6">
        <h3 className="text-sm font-semibold text-ink mb-3">Activity</h3>
        <DocActivityPanel doctype="DataImport" docId={params.id} />
      </div>
</AppShell>
  );
}
