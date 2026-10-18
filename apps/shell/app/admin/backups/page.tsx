"use client";

import { showToast } from "../../../lib/toast";
import { useListPageCommands } from "@lumaara/web-ui";

import { useEffect, useState } from "react";
import { dashboardApi } from "../../../lib/dashboards";
import { AppShell } from "../../../components/app-shell";
import { SHELL_NAV } from "../../../components/shell-nav";
import {
  Button,
  DataTable,
  PageHeader,
  StatusBadge,
  Toast,
  dateShort,
  type Column,
} from "../../../components/ui";

interface Backup {
  id: string;
  kind: string;
  status: string;
  outputPath: string | null;
  sizeBytes: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  createdAt: string;
  s3Key: string | null;
  s3UploadedAt: string | null;
  lastVerify: {
    id: string;
    status: string;
    source: string;
    verifiedAt: string;
    error: string | null;
  } | null;
}

export default function BackupsPage() {
  const [rows, setRows] = useState<Backup[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      setRows(await dashboardApi.get<Backup[]>("/backups"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  useListPageCommands({
    singular: "Backup",
    plural: "Backups",
    refresh: load,
  });

  async function trigger(kind: "full" | "schema-only" | "data-only") {
    setBusy(true);
    try {
      await dashboardApi.post("/backups", { kind });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function verify(id: string) {
    setBusy(true);
    setError(null);
    try {
      const r = await dashboardApi.post<{ status: string; source: string; error?: string }>(
        `/backups/${id}/verify`,
        {},
      );
      if (r.status === "Failed") {
        showToast(`Verification failed (${r.source}): ${r.error ?? "unknown"}`, "error");
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function prune() {
    const last = prompt("Keep last N backups (default 30, blank = ignore):", "30");
    if (last === null) return;
    const days = prompt("Keep for at most D days (default 90, blank = ignore):", "90");
    if (days === null) return;
    const body: { keepLast?: number; keepDays?: number } = {};
    if (last.trim()) body.keepLast = Number(last);
    if (days.trim()) body.keepDays = Number(days);
    if (!body.keepLast && !body.keepDays) {
      showToast("Nothing to prune (both blank).", "info");
      return;
    }
    setBusy(true);
    try {
      const r = await dashboardApi.post<{ deleted: number }>("/backups/prune", body);
      showToast(`Pruned ${r.deleted} backup(s).`, "success");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<Backup>[] = [
    { header: "Created", cell: (r) => <span className="text-xs text-ink-soft">{dateShort(r.createdAt)}</span> },
    { header: "Kind", cell: (r) => <span className="text-xs text-ink-soft">{r.kind}</span> },
    { header: "Status", cell: (r) => <StatusBadge status={r.status === "Succeeded" ? "Completed" : r.status} /> },
    {
      header: "Size",
      align: "right",
      cell: (r) => (
        <span className="text-xs tabular-nums text-ink-soft">
          {r.sizeBytes ? `${(Number(r.sizeBytes) / 1024 / 1024).toFixed(2)} MB` : "—"}
        </span>
      ),
    },
    {
      header: "Offsite (S3)",
      cell: (r) =>
        r.s3UploadedAt ? (
          <span className="text-xs text-emerald-700">
            ✓ {dateShort(r.s3UploadedAt)}
          </span>
        ) : r.status === "Succeeded" ? (
          <span className="text-xs text-amber-700">host-only</span>
        ) : (
          <span className="text-xs text-ink-muted">—</span>
        ),
    },
    {
      header: "Last verified",
      cell: (r) =>
        r.lastVerify ? (
          <span
            className={
              r.lastVerify.status === "Failed"
                ? "text-red-600 text-xs"
                : "text-emerald-700 text-xs"
            }
            title={r.lastVerify.error ?? ""}
          >
            {r.lastVerify.status === "Failed" ? "✗" : "✓"} {dateShort(r.lastVerify.verifiedAt)}{" "}
            <span className="text-ink-muted">({r.lastVerify.source})</span>
          </span>
        ) : (
          <span className="text-xs text-ink-muted">never</span>
        ),
    },
    { header: "Error", cell: (r) => <span className="text-xs text-red-600">{r.error ?? ""}</span> },
    {
      header: "",
      align: "right",
      cell: (r) =>
        r.status === "Succeeded" && (
          <button
            onClick={() => verify(r.id)}
            disabled={busy}
            className="text-xs text-brand-600 hover:underline"
          >
            Verify
          </button>
        ),
    },
  ];

  return (
    <AppShell moduleName="Home" nav={SHELL_NAV}>
      <PageHeader
        breadcrumb={[{ label: "Admin", href: "/admin" }, { label: "Backups" }]}
        title="Backups"
        subtitle={
          <>
            Uses <code>pg_dump</code>. Backups write to{" "}
            <code>{`$BACKUP_DIR (default /tmp/lumaara-backups)`}</code>. Successful
            backups auto-prune per <code>BACKUP_KEEP_LAST</code> +{" "}
            <code>BACKUP_KEEP_DAYS</code> (defaults 30 / 90).
          </>
        }
        actions={
          <>
            <Button variant="secondary" onClick={prune} disabled={busy} type="button">
              Prune…
            </Button>
            <Button variant="secondary" onClick={() => trigger("schema-only")} disabled={busy} type="button">
              Schema only
            </Button>
            <Button variant="brand" onClick={() => trigger("full")} disabled={busy} type="button">
              Run full backup
            </Button>
          </>
        }
      />

      {error && (
        <div className="mb-4">
          <Toast kind="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      <div className="max-w-6xl">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          loading={loading}
          empty={{ title: "No backups yet" }}
        />
      </div>
    </AppShell>
  );
}
