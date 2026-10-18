"use client";

import { useEffect, useState } from "react";
import { dashboardApi } from "../../../lib/dashboards";
import { AppShell } from "../../../components/app-shell";
import { SHELL_NAV } from "../../../components/shell-nav";
import {
  Button,
  Card,
  PageHeader,
  SectionHeader,
  Skeleton,
  Toast,
} from "../../../components/ui";

interface SystemInfo {
  version: string;
  node: string;
  uptimeSec: number;
  memory: { rss: number; heapUsed: number; heapTotal: number };
  dbSize: string;
  counts: Record<string, number>;
}

function fmtUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}
function fmtMB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function SystemPage() {
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setInfo(await dashboardApi.get<SystemInfo>("/system-info"));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed");
      }
    })();
  }, []);

  return (
    <AppShell moduleName="Home" nav={SHELL_NAV}>
      <PageHeader
        breadcrumb={[{ label: "Admin", href: "/admin" }, { label: "System" }]}
        title="System"
        subtitle="Runtime version, uptime, memory, DB size, and per-tenant row counts."
        actions={
          <Button variant="secondary" onClick={() => history.back()} type="button">
            ← Back
          </Button>
        }
      />

      {error && (
        <div className="mb-4">
          <Toast kind="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      <div className="max-w-4xl space-y-4">
        {!info ? (
          <div className="grid grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24" rounded="rounded-lg" />
            ))}
          </div>
        ) : (
          <>
            <section className="grid grid-cols-4 gap-4">
              <Card className="p-4">
                <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">Version</div>
                <div className="text-lg font-semibold text-ink">{info.version}</div>
                <div className="text-xs text-ink-muted mt-1">Node {info.node}</div>
              </Card>
              <Card className="p-4">
                <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">Uptime</div>
                <div className="text-lg font-semibold text-ink">{fmtUptime(info.uptimeSec)}</div>
              </Card>
              <Card className="p-4">
                <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">Heap</div>
                <div className="text-lg font-semibold text-ink tabular-nums">
                  {fmtMB(info.memory.heapUsed)}
                </div>
                <div className="text-xs text-ink-muted mt-1">
                  of {fmtMB(info.memory.heapTotal)}
                </div>
              </Card>
              <Card className="p-4">
                <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">DB size</div>
                <div className="text-lg font-semibold text-ink">{info.dbSize}</div>
              </Card>
            </section>

            <Card className="p-4">
              <SectionHeader title="Row counts (this tenant)" />
              <table className="w-full text-sm">
                <tbody>
                  {Object.entries(info.counts).map(([k, v]) => (
                    <tr key={k} className="border-t border-ink-muted/10">
                      <td className="py-1 capitalize text-ink-soft">
                        {k.replace(/([A-Z])/g, " $1")}
                      </td>
                      <td className="py-1 text-end font-mono tabular-nums text-ink">{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </>
        )}
      </div>
    </AppShell>
  );
}
