// Server-side status aggregator. Fans out to each service's /health/ready
// endpoint and returns a single JSON payload with per-service state.
// Called by /status (user-facing) + any external monitors.
//
// We hit the endpoints server-side (not from the browser) so no CORS /
// cross-origin pain + we can access the internal service hostnames in
// prod (which may differ from the browser-reachable ones).

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface ServiceStatus {
  name: string;
  url: string;
  ok: boolean;
  latencyMs: number;
  detail?: string;
}

const SERVICES: Array<{ name: string; url: string }> = [
  { name: "auth-service", url: process.env.AUTH_SERVICE_INTERNAL_URL ?? process.env.NEXT_PUBLIC_AUTH_SERVICE_URL ?? "http://localhost:4001" },
  { name: "accounting-service", url: process.env.ACCOUNTING_SERVICE_INTERNAL_URL ?? process.env.NEXT_PUBLIC_ACCOUNTING_SERVICE_URL ?? "http://localhost:4002" },
  { name: "stock-service", url: process.env.STOCK_SERVICE_INTERNAL_URL ?? process.env.NEXT_PUBLIC_STOCK_SERVICE_URL ?? "http://localhost:4003" },
  { name: "crm-service", url: process.env.CRM_SERVICE_INTERNAL_URL ?? process.env.NEXT_PUBLIC_CRM_SERVICE_URL ?? "http://localhost:4004" },
  { name: "hr-service", url: process.env.HR_SERVICE_INTERNAL_URL ?? process.env.NEXT_PUBLIC_HR_SERVICE_URL ?? "http://localhost:4005" },
  { name: "projects-service", url: process.env.PROJECTS_SERVICE_INTERNAL_URL ?? process.env.NEXT_PUBLIC_PROJECTS_SERVICE_URL ?? "http://localhost:4006" },
  { name: "scheduler", url: process.env.SCHEDULER_INTERNAL_URL ?? "http://localhost:4009" },
  { name: "mcp-server", url: process.env.MCP_SERVER_INTERNAL_URL ?? "http://localhost:4110" },
];

async function probe(svc: { name: string; url: string }): Promise<ServiceStatus> {
  const started = Date.now();
  try {
    const r = await fetch(`${svc.url}/health/ready`, {
      // Short timeout — status pages should never block on a hung service.
      signal: AbortSignal.timeout(3_000),
      cache: "no-store",
    });
    const body = r.ok
      ? ((await r.json().catch(() => ({}))) as { ok?: boolean; checks?: unknown })
      : null;
    return {
      name: svc.name,
      url: svc.url,
      ok: r.ok && body?.ok !== false,
      latencyMs: Date.now() - started,
      detail: r.ok ? undefined : `HTTP ${r.status}`,
    };
  } catch (e) {
    return {
      name: svc.name,
      url: svc.url,
      ok: false,
      latencyMs: Date.now() - started,
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function GET() {
  const results = await Promise.all(SERVICES.map(probe));
  const allOk = results.every((r) => r.ok);
  return NextResponse.json(
    {
      ok: allOk,
      checkedAt: new Date().toISOString(),
      services: results,
    },
    {
      status: allOk ? 200 : 503,
      headers: { "cache-control": "no-store" },
    },
  );
}
