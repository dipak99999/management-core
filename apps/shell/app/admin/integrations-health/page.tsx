"use client";

// Admin → Integrations Health. One-screen view of which optional
// providers the tenant has wired. Addresses the "silent 503" risk —
// shows admins what will *not* work before a user hits it.

import { useEffect, useState } from "react";
import { AppShell, Icon, PageHeader } from "../../../components/app-shell";
import { SHELL_NAV } from "../../../components/shell-nav";

const ACCOUNTING_URL =
  process.env.NEXT_PUBLIC_ACCOUNTING_SERVICE_URL ?? "/api/accounting";

interface Entry {
  provider: string;
  category: string;
  label: string;
  configured: boolean;
  active: boolean;
  note?: string;
}
interface HealthPayload {
  configured: number;
  total: number;
  coverage: number;
  entries: Entry[];
}

function tokenFromStorage(): string | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem("lumaara.session");
  if (!raw) return null;
  try {
    return (JSON.parse(raw) as { token?: string }).token ?? null;
  } catch { return null; }
}

export default function IntegrationsHealthPage() {
  const [data, setData] = useState<HealthPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = tokenFromStorage();
    if (!token) { setError("Not authenticated"); return; }
    fetch(`${ACCOUNTING_URL}/integrations/health`, {
      headers: { authorization: `Bearer ${token}` },
    })
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  }, []);

  const grouped = (data?.entries ?? []).reduce((acc, e) => {
    (acc[e.category] ??= []).push(e);
    return acc;
  }, {} as Record<string, Entry[]>);

  return (
    <AppShell moduleName="Admin" nav={SHELL_NAV}>
      <PageHeader
        icon={Icon.dashboard}
        eyebrow="Admin"
        title="Integrations Health"
        subtitle="Which pluggable providers this tenant has wired. Red rows mean the related feature will return 503 until configured."
      />

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 text-red-900 p-3 text-sm mb-4">
          {error}
        </div>
      )}

      {data && (
        <div className="mb-6 flex items-center gap-4">
          <div className="text-3xl font-semibold tabular-nums">
            {data.configured}
            <span className="text-ink-muted text-lg"> / {data.total}</span>
          </div>
          <div className="text-sm text-ink-muted">
            {data.coverage}% coverage
          </div>
          <div className="flex-1 h-2 rounded-full bg-ink/8 overflow-hidden max-w-xs">
            <div
              className="h-full bg-emerald-500 transition-all"
              style={{ width: `${data.coverage}%` }}
            />
          </div>
        </div>
      )}

      <div className="space-y-6">
        {Object.entries(grouped).map(([cat, items]) => (
          <section key={cat}>
            <h3 className="text-[11px] uppercase tracking-widest text-ink-muted font-semibold mb-2">
              {cat}
            </h3>
            <div className="rounded-xl border border-ink/8 bg-white divide-y divide-ink/5">
              {items.map((e) => (
                <div key={e.provider} className="flex items-center gap-3 px-4 py-3">
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${
                      e.active ? "bg-emerald-500" : e.configured ? "bg-amber-400" : "bg-ink/20"
                    }`}
                    aria-hidden
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-ink">{e.label}</div>
                    {e.note && (
                      <div className="text-xs text-ink-muted">{e.note}</div>
                    )}
                  </div>
                  <span
                    className={`text-[11px] uppercase tracking-wider font-semibold ${
                      e.active ? "text-emerald-700" : e.configured ? "text-amber-700" : "text-ink-muted"
                    }`}
                  >
                    {e.active ? "Active" : e.configured ? "Inactive" : "Not configured"}
                  </span>
                  <a
                    href="/settings/integrations"
                    className="text-xs text-ink hover:underline"
                  >
                    Configure →
                  </a>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </AppShell>
  );
}
