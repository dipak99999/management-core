"use client";

// AI Insights card — mounts on an entity detail page and renders a
// doctype-specific advisory from the backend. Fetches on mount; shows
// skeleton while thinking; renders findings, risk flags, and suggested
// actions. "Refresh" bypasses the 24h cache.

import { useEffect, useState } from "react";

type Doctype = "Lead" | "Customer" | "SalesInvoice" | "Employee" | "Item";

interface RiskFlag {
  severity: "low" | "med" | "high";
  label: string;
  why: string;
}
interface SuggestedAction {
  label: string;
  href?: string;
}
interface Payload {
  oneLiner: string;
  bulletFindings: string[];
  riskFlags: RiskFlag[];
  suggestedActions: SuggestedAction[];
  sources?: Array<{ title: string; url: string }>;
}
interface InsightResponse {
  payload: Payload;
  model: string | null;
  generatedAt: string;
  cached: boolean;
}

const ACCOUNTING_URL =
  process.env.NEXT_PUBLIC_ACCOUNTING_SERVICE_URL ?? "/api/accounting";

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem("lumaara.session");
  if (!raw) return null;
  try { return (JSON.parse(raw) as { token?: string }).token ?? null; }
  catch { return null; }
}

// Open the shell's Brew panel with a prefilled prompt. Writes to the
// shell's localStorage keys that useBrewController + the panel toggle
// read on mount. Works because microfrontends share the shell's origin
// via the rewrite proxy.
function askBrewAbout(prompt: string): void {
  try {
    localStorage.setItem("appshell.brewPanel", "1");
    localStorage.setItem("appshell.brewPrefill", prompt);
    // Fire a same-tab event so the panel can pick it up without reload.
    window.dispatchEvent(new CustomEvent("lumaara:brew-prefill", { detail: prompt }));
    // If we're inside a microfrontend without the panel mounted in this
    // frame, fall back to a full nav to the dashboard where the panel
    // auto-opens from the stored flag.
    if (!document.querySelector('[aria-label="Brew AI coworker"]')) {
      window.location.href = "/";
    }
  } catch {
    // storage disabled — just drop the request
  }
}

export function AiInsightCard({
  doctype,
  docId,
  subject,
}: {
  doctype: Doctype;
  docId: string;
  subject?: string; // optional entity name for the prefilled prompt
}) {
  const [data, setData] = useState<InsightResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showWhy, setShowWhy] = useState(false);
  const [askText, setAskText] = useState("");

  async function load(refresh = false) {
    const token = getToken();
    if (!token) { setError("Not authenticated"); setLoading(false); return; }
    if (refresh) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const url = refresh
        ? `${ACCOUNTING_URL}/ai/insights/${doctype}/${docId}/refresh`
        : `${ACCOUNTING_URL}/ai/insights/${doctype}/${docId}`;
      const r = await fetch(url, {
        method: refresh ? "POST" : "GET",
        headers: { authorization: `Bearer ${token}` },
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
        setError(body.error ?? `HTTP ${r.status}`);
        return;
      }
      setData((await r.json()) as InsightResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doctype, docId]);

  return (
    <div className="rounded-xl border border-gold-200/60 bg-gradient-to-br from-gold-50/50 to-canvas-warm/30 p-4">
      <header className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span
            className={`h-6 w-6 rounded-md bg-brand-gradient text-white grid place-items-center text-xs ${
              refreshing ? "animate-pulse" : ""
            }`}
            aria-hidden
          >
            <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10 2l1.5 4.5L16 8l-4.5 1.5L10 14l-1.5-4.5L4 8l4.5-1.5L10 2z" />
            </svg>
          </span>
          <h3 className="text-sm font-semibold text-ink">AI Insights</h3>
          {refreshing && (
            <span className="text-[10px] text-brand-700 uppercase tracking-wider animate-pulse">thinking…</span>
          )}
          {!refreshing && data?.cached && (
            <span className="text-[10px] text-ink-muted uppercase tracking-wider">cached</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {data?.model && (
            <button
              onClick={() => setShowWhy((v) => !v)}
              className="text-[11px] text-ink-muted hover:text-ink px-2 py-1 rounded hover:bg-white"
              title="See what the AI was given"
            >
              Why?
            </button>
          )}
          <button
            onClick={() => load(true)}
            disabled={loading || refreshing}
            className="text-[11px] font-medium text-ink-muted hover:text-ink disabled:opacity-50 px-2 py-1 rounded hover:bg-white"
          >
            {refreshing ? "Thinking…" : "Refresh"}
          </button>
        </div>
      </header>

      {loading && (
        <div className="space-y-2 animate-pulse">
          <div className="h-3 w-4/5 bg-ink/10 rounded" />
          <div className="h-3 w-3/5 bg-ink/10 rounded" />
          <div className="h-3 w-2/3 bg-ink/10 rounded" />
        </div>
      )}

      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
        </div>
      )}

      {!loading && !error && data && (
        <>
          <p className="text-sm text-ink leading-relaxed mb-3">{data.payload.oneLiner}</p>

          {data.payload.bulletFindings.length > 0 && (
            <ul className="space-y-1.5 mb-3">
              {data.payload.bulletFindings.map((f, i) => (
                <li key={i} className="text-sm text-ink-soft flex gap-2">
                  <span className="text-gold-700 mt-0.5" aria-hidden>•</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          )}

          {data.payload.riskFlags.length > 0 && (
            <div className="space-y-1.5 mb-3">
              {data.payload.riskFlags.map((r, i) => (
                <div
                  key={i}
                  className={`text-xs rounded px-2 py-1.5 ${
                    r.severity === "high"
                      ? "bg-red-50 text-red-900 border border-red-200"
                      : r.severity === "med"
                      ? "bg-amber-50 text-amber-900 border border-amber-200"
                      : "bg-ink/5 text-ink-soft border border-ink/10"
                  }`}
                >
                  <div className="font-semibold">⚠ {r.label}</div>
                  <div className="opacity-80">{r.why}</div>
                </div>
              ))}
            </div>
          )}

          {data.payload.suggestedActions.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {data.payload.suggestedActions.map((a, i) =>
                a.href ? (
                  <a
                    key={i}
                    href={a.href}
                    className="text-xs rounded-pill bg-white border border-ink/10 hover:border-ink/25 text-ink px-3 py-1.5"
                  >
                    {a.label} →
                  </a>
                ) : (
                  <span
                    key={i}
                    className="text-xs rounded-pill bg-white border border-ink/10 text-ink-soft px-3 py-1.5"
                  >
                    {a.label}
                  </span>
                ),
              )}
            </div>
          )}

          {data.payload.sources && data.payload.sources.length > 0 && (
            <div className="mt-3 pt-3 border-t border-ink/5">
              <div className="text-[10px] uppercase tracking-wider text-ink-muted mb-1">
                Public sources
              </div>
              <ul className="space-y-0.5">
                {data.payload.sources.map((s, i) => (
                  <li key={i} className="text-xs">
                    <a href={s.url} target="_blank" rel="noopener noreferrer"
                       className="text-ink-soft hover:text-ink underline underline-offset-2">
                      {s.title}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <form
            className="mt-3 pt-3 border-t border-ink/5 flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const q = askText.trim();
              if (!q) return;
              const subjectLabel = subject ? ` (${subject})` : "";
              askBrewAbout(`[About ${doctype} ${docId}${subjectLabel}]\n${q}`);
              setAskText("");
            }}
          >
            <input
              type="text"
              value={askText}
              onChange={(e) => setAskText(e.target.value)}
              placeholder={`Ask Brew about this ${doctype.toLowerCase()}…`}
              className="flex-1 text-sm bg-white border border-ink/10 rounded-lg px-3 py-1.5 placeholder:text-ink-faint focus:outline-none focus:border-ink/30"
            />
            <button
              type="submit"
              disabled={!askText.trim()}
              className="text-xs font-semibold text-ink hover:text-brand-700 disabled:opacity-40 px-3 py-1.5"
            >
              Ask →
            </button>
          </form>

          {showWhy && (
            <div className="mt-3 pt-3 border-t border-ink/5 text-[11px] text-ink-muted">
              Generated by <span className="font-mono">{data.model ?? "unknown"}</span> on{" "}
              {new Date(data.generatedAt).toLocaleString()}. Inputs: the entity's own fields plus
              recent related activity (invoices for customers, approved leaves for employees, etc.).
              {data.payload.sources ? " Public web results were also used." : " No public web lookup."}
            </div>
          )}
        </>
      )}
    </div>
  );
}
