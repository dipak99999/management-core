"use client";

// AI Inbox — stream of noteworthy observations the scheduler surfaced.
// Each row is a card with severity dot + category + title + finding +
// optional action link. Users can Acknowledge (gone for good) or
// Dismiss (hidden for N days — then re-surfaces if still true).

import { useCallback, useEffect, useState } from "react";
import { showToast } from "../../lib/toast";
import { AppShell, Icon, PageHeader } from "../../components/app-shell";
import { SHELL_NAV } from "../../components/shell-nav";
import { Button } from "../../components/ui";

const ACCOUNTING_URL =
  process.env.NEXT_PUBLIC_ACCOUNTING_SERVICE_URL ?? "/api/accounting";

interface InboxEntry {
  id: string;
  signalKey: string;
  kind: string;
  severity: "info" | "watch" | "critical";
  category: string;
  title: string;
  finding: string;
  targetDoctype: string | null;
  targetDocId: string | null;
  actionLabel: string | null;
  actionHref: string | null;
  dataJson: Record<string, unknown> | null;
  firstSeenAt: string;
  lastSeenAt: string;
  acknowledgedAt: string | null;
  dismissedAt: string | null;
  dismissedUntil: string | null;
}

function tokenFromStorage(): string | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem("lumaara.session");
  if (!raw) return null;
  try { return (JSON.parse(raw) as { token?: string }).token ?? null; }
  catch { return null; }
}

async function inboxFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = tokenFromStorage();
  const r = await fetch(`${ACCOUNTING_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  if (r.status === 204) return null as unknown as T;
  return (await r.json()) as T;
}

function sevDot(severity: InboxEntry["severity"]): string {
  return severity === "critical"
    ? "bg-red-500"
    : severity === "watch"
    ? "bg-amber-500"
    : "bg-sky-500";
}

function relTime(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function AiInboxPage() {
  const [rows, setRows] = useState<InboxEntry[]>([]);
  const [filter, setFilter] = useState<"open" | "all">("open");
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await inboxFetch<InboxEntry[]>(`/ai/inbox?filter=${filter}`));
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Load failed", "error");
    } finally {
      setLoading(false);
    }
  }, [filter]);
  useEffect(() => { load(); }, [load]);

  async function scanNow() {
    setScanning(true);
    try {
      const r = await inboxFetch<{ inserted: number; refreshed: number }>("/ai/inbox/scan", { method: "POST" });
      showToast(`Scanned — ${r.inserted} new, ${r.refreshed} refreshed`, "success");
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Scan failed", "error");
    } finally {
      setScanning(false);
    }
  }

  async function acknowledge(id: string) {
    await inboxFetch(`/ai/inbox/${id}/acknowledge`, { method: "POST" });
    setRows((xs) => xs.filter((x) => x.id !== id));
  }
  async function dismiss(id: string, days = 7) {
    await inboxFetch(`/ai/inbox/${id}/dismiss`, { method: "POST", body: JSON.stringify({ days }) });
    setRows((xs) => xs.filter((x) => x.id !== id));
  }

  // Snooze presets — "Tomorrow", "Next Monday", "In 1 week", "In 1 month".
  // Convert to the integer `days` the backend already understands.
  function snoozePresetDays(preset: "tomorrow" | "monday" | "week" | "month"): number {
    const now = new Date();
    if (preset === "week") return 7;
    if (preset === "month") return 30;
    if (preset === "tomorrow") return 1;
    // "monday" — days until the next Monday (0 = already Mon → next week)
    const day = now.getDay(); // 0 Sun, 1 Mon, …, 6 Sat
    const daysToNextMon = ((8 - day) % 7) || 7;
    return daysToNextMon;
  }

  const [snoozeOpenFor, setSnoozeOpenFor] = useState<string | null>(null);

  const grouped = rows.reduce((acc, r) => {
    (acc[r.category] ??= []).push(r);
    return acc;
  }, {} as Record<string, InboxEntry[]>);

  return (
    <AppShell moduleName="AI" nav={SHELL_NAV}>
      <PageHeader
        icon={Icon.sparkles ?? Icon.dashboard}
        eyebrow="AI"
        title="AI Inbox"
        subtitle="Things the agent noticed in your workspace — overdue invoices, stale deals, inventory running low, cash runway tightening. New findings land here; dismiss what you don't care about."
        actions={
          <>
            <div className="inline-flex bg-white rounded-pill border border-ink/10 p-0.5">
              <button
                onClick={() => setFilter("open")}
                className={`px-3 py-1.5 rounded-pill text-[11px] font-semibold uppercase tracking-widest ${
                  filter === "open" ? "bg-ink text-white" : "text-ink-muted hover:text-ink"
                }`}
              >
                Open
              </button>
              <button
                onClick={() => setFilter("all")}
                className={`px-3 py-1.5 rounded-pill text-[11px] font-semibold uppercase tracking-widest ${
                  filter === "all" ? "bg-ink text-white" : "text-ink-muted hover:text-ink"
                }`}
              >
                All
              </button>
            </div>
            <Button variant="secondary" onClick={scanNow} disabled={scanning}>
              {scanning ? "Scanning…" : "Scan now"}
            </Button>
          </>
        }
      />

      {!loading && rows.length === 0 && (
        <div className="rounded-xl border border-ink/8 bg-white p-10 text-center">
          <div className="mx-auto mb-3 h-16 w-16 rounded-2xl bg-canvas-warm grid place-items-center text-emerald-600">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-ink">Nothing to flag</h2>
          <p className="text-sm text-ink-muted mt-1 max-w-sm mx-auto">
            {filter === "open"
              ? "No open findings. Either the business is in great shape, or the scheduler hasn't run yet (click Scan now)."
              : "No findings have been generated yet."}
          </p>
        </div>
      )}

      <div className="space-y-6">
        {Object.entries(grouped).map(([category, items]) => (
          <section key={category}>
            <h3 className="text-[11px] uppercase tracking-widest text-ink-muted font-semibold mb-2">
              {category} <span className="text-ink-faint">({items.length})</span>
            </h3>
            <ul className="space-y-2">
              {items.map((r) => (
                <li key={r.id} className="rounded-xl border border-ink/8 bg-white p-4">
                  <div className="flex items-start gap-3">
                    <span
                      className={`mt-1.5 h-2.5 w-2.5 rounded-full flex-shrink-0 ${sevDot(r.severity)}`}
                      aria-label={r.severity}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-ink">{r.title}</div>
                          <p className="text-sm text-ink-soft mt-1 leading-relaxed">{r.finding}</p>
                          <div className="text-[11px] text-ink-muted mt-2">
                            {relTime(r.lastSeenAt)}
                            {r.firstSeenAt !== r.lastSeenAt && (
                              <> · first seen {relTime(r.firstSeenAt)}</>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {r.actionHref && (
                            <a href={r.actionHref} className="btn-ghost text-xs">
                              {r.actionLabel ?? "Open"}
                            </a>
                          )}
                          <div className="relative">
                            <button
                              type="button"
                              onClick={() => setSnoozeOpenFor(snoozeOpenFor === r.id ? null : r.id)}
                              className="text-xs text-ink-muted hover:text-ink px-2 py-1 rounded hover:bg-canvas-warm"
                              title="Snooze (will re-surface if still true)"
                            >
                              Snooze ▾
                            </button>
                            {snoozeOpenFor === r.id && (
                              <div
                                className="absolute end-0 top-full mt-1 w-44 card py-1 text-sm z-20"
                                onMouseLeave={() => setSnoozeOpenFor(null)}
                              >
                                {([
                                  { k: "tomorrow", label: "Until tomorrow" },
                                  { k: "monday", label: "Until next Monday" },
                                  { k: "week", label: "For 1 week" },
                                  { k: "month", label: "For 1 month" },
                                ] as const).map((p) => (
                                  <button
                                    key={p.k}
                                    type="button"
                                    onClick={() => {
                                      setSnoozeOpenFor(null);
                                      void dismiss(r.id, snoozePresetDays(p.k));
                                    }}
                                    className="w-full text-start px-3 py-1.5 hover:bg-canvas-warm text-ink-soft text-xs"
                                  >
                                    {p.label}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => acknowledge(r.id)}
                            className="text-xs text-ink hover:text-brand-700 font-medium px-2 py-1 rounded hover:bg-canvas-warm"
                            title="Mark as handled"
                          >
                            Acknowledge
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </AppShell>
  );
}
