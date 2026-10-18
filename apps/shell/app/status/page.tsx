"use client";

// Public status page. Polls /api/status every 15s and shows a per-service
// health grid. Deliberately unauthed — operators + customers should be
// able to check the stack is up without logging in. The /api/status
// backend only exposes service name + ok + latency — no secrets.

import { useEffect, useState } from "react";

interface ServiceStatus {
  name: string;
  url: string;
  ok: boolean;
  latencyMs: number;
  detail?: string;
}
interface StatusPayload {
  ok: boolean;
  checkedAt: string;
  services: ServiceStatus[];
}

const POLL_MS = 15_000;

export default function StatusPage() {
  const [data, setData] = useState<StatusPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function fetchStatus(): Promise<void> {
    try {
      const r = await fetch("/api/status", { cache: "no-store" });
      // Both 200 and 503 return a body; parse either.
      const body = (await r.json()) as StatusPayload;
      setData(body);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Status check failed");
    }
  }

  useEffect(() => {
    void fetchStatus();
    const h = setInterval(() => void fetchStatus(), POLL_MS);
    return () => clearInterval(h);
  }, []);

  const anyDown = data && !data.ok;

  return (
    <main className="min-h-screen bg-canvas p-8 flex items-start justify-center">
      <div className="w-full max-w-3xl">
        <header className="mb-8">
          <h1 className="font-wordmark text-3xl mb-2">LUMAARA Status</h1>
          <div className="flex items-center gap-3">
            <span
              className={`inline-block w-3 h-3 rounded-full ${
                data === null ? "bg-ink-muted" : anyDown ? "bg-red-500" : "bg-green-500"
              } ${data?.ok ? "animate-pulse" : ""}`}
              aria-hidden
            />
            <span className="text-ink font-medium">
              {data === null
                ? "Checking…"
                : anyDown
                ? "Some services are degraded"
                : "All systems operational"}
            </span>
          </div>
          {data?.checkedAt && (
            <p className="text-xs text-ink-muted mt-1">
              Last checked {new Date(data.checkedAt).toLocaleString()} · auto-refresh every 15s
            </p>
          )}
          {error && (
            <p className="text-sm text-red-600 mt-2" role="alert">
              {error}
            </p>
          )}
        </header>

        <div className="card p-0 overflow-hidden">
          <div className="divide-y divide-ink/10">
            {(data?.services ?? []).map((s) => (
              <div key={s.name} className="flex items-center justify-between px-5 py-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className={`inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                      s.ok ? "bg-green-500" : "bg-red-500"
                    }`}
                    aria-hidden
                  />
                  <div className="min-w-0">
                    <div className="font-medium text-ink">{s.name}</div>
                    {!s.ok && s.detail && (
                      <div className="text-xs text-red-600 truncate" title={s.detail}>
                        {s.detail}
                      </div>
                    )}
                  </div>
                </div>
                <div className="text-xs text-ink-muted tabular-nums flex-shrink-0 ms-4">
                  {s.ok ? `${s.latencyMs}ms` : "down"}
                </div>
              </div>
            ))}
            {!data && !error && (
              <div className="px-5 py-6 text-sm text-ink-muted">Loading…</div>
            )}
          </div>
        </div>

        <p className="text-xs text-ink-muted mt-6">
          For incident updates and planned maintenance, check your email or Admin → Notifications.
        </p>
      </div>
    </main>
  );
}
