"use client";

// AI Inbox preferences — per-user. Pick which categories to see + opt in
// to the daily digest email + set the minimum severity for the digest so
// a user only gets paged for things that actually matter to them.

import { useEffect, useState } from "react";
import { showToast } from "../../../lib/toast";
import { AppShell, Icon, PageHeader } from "../../../components/app-shell";
import { SHELL_NAV } from "../../../components/shell-nav";
import { Button } from "../../../components/ui";

const ACCOUNTING_URL =
  process.env.NEXT_PUBLIC_ACCOUNTING_SERVICE_URL ?? "/api/accounting";

type Severity = "info" | "watch" | "critical";
type CatFreq = "daily" | "weekly" | "never";

interface Prefs {
  mutedCategories: string[];
  dailyDigest: boolean;
  digestMinSeverity: Severity;
  categoryFrequency: Record<string, CatFreq>;
  webhookUrl: string | null;
  webhookType: "slack" | "teams" | "generic" | null;
  availableCategories: string[];
}

interface TenantConfig {
  llmSystemPrompt: string | null;
}

function tokenFromStorage(): string | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem("lumaara.session");
  if (!raw) return null;
  try { return (JSON.parse(raw) as { token?: string }).token ?? null; }
  catch { return null; }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
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
  return (await r.json()) as T;
}

export default function AiInboxPreferencesPage() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [tenantCfg, setTenantCfg] = useState<TenantConfig | null>(null);
  const [tenantCfgDraft, setTenantCfgDraft] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Prefs>("/ai/inbox/preferences")
      .then(setPrefs)
      .catch((e) => showToast(e instanceof Error ? e.message : "Load failed", "error"));
    // Tenant config: 403 is fine for non-admins — just hide the section.
    api<TenantConfig>("/ai/inbox/tenant-config")
      .then((r) => { setTenantCfg(r); setTenantCfgDraft(r.llmSystemPrompt ?? ""); })
      .catch(() => { /* non-admin or server returned error — hide the panel */ });
  }, []);

  async function save(patch: Partial<Prefs>) {
    if (!prefs) return;
    const next = { ...prefs, ...patch };
    setPrefs(next);
    setBusy(true);
    try {
      await api<Prefs>("/ai/inbox/preferences", {
        method: "PUT",
        body: JSON.stringify(patch),
      });
      showToast("Preferences updated", "success");
    } catch (e) {
      setPrefs(prefs); // rollback
      showToast(e instanceof Error ? e.message : "Save failed", "error");
    } finally {
      setBusy(false);
    }
  }

  function toggleCategory(cat: string) {
    if (!prefs) return;
    const muted = prefs.mutedCategories.includes(cat)
      ? prefs.mutedCategories.filter((c) => c !== cat)
      : [...prefs.mutedCategories, cat];
    save({ mutedCategories: muted });
  }

  function setCategoryFrequency(cat: string, freq: CatFreq) {
    if (!prefs) return;
    const next = { ...prefs.categoryFrequency, [cat]: freq };
    save({ categoryFrequency: next });
  }

  async function saveTenantConfig() {
    setBusy(true);
    try {
      const r = await api<TenantConfig>("/ai/inbox/tenant-config", {
        method: "PUT",
        body: JSON.stringify({ llmSystemPrompt: tenantCfgDraft.trim() || null }),
      });
      setTenantCfg(r);
      showToast("LLM prompt saved", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Save failed", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell moduleName="Settings" nav={SHELL_NAV}>
      <PageHeader
        icon={Icon.sparkles ?? Icon.dashboard}
        eyebrow="Settings"
        title="AI Inbox preferences"
        subtitle="Pick the categories you want to see in your inbox + badge count. Opt into the daily digest to get an email summary (fired at 09:00 local across most time zones)."
      />

      {!prefs ? (
        <div className="text-sm text-ink-muted">Loading…</div>
      ) : (
        <div className="space-y-8 max-w-3xl">
          <section>
            <h3 className="text-sm font-semibold text-ink mb-3">Categories</h3>
            <p className="text-xs text-ink-muted mb-4">
              Uncheck a category to hide it from your inbox and badge count. Other users on
              the same workspace see their own filtered view.
            </p>
            <div className="grid grid-cols-2 gap-3">
              {prefs.availableCategories.map((cat) => {
                const subscribed = !prefs.mutedCategories.includes(cat);
                return (
                  <label
                    key={cat}
                    className={`flex items-center gap-3 rounded-xl border p-3 cursor-pointer transition ${
                      subscribed ? "border-ink/15 bg-white" : "border-ink/8 bg-canvas-warm/40"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={subscribed}
                      onChange={() => toggleCategory(cat)}
                      disabled={busy}
                      className="h-4 w-4 accent-ink"
                    />
                    <span className={`text-sm font-medium ${subscribed ? "text-ink" : "text-ink-muted"}`}>
                      {cat}
                    </span>
                  </label>
                );
              })}
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-ink mb-3">Daily digest email</h3>
            <div className="rounded-xl border border-ink/8 bg-white p-4 space-y-4">
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={prefs.dailyDigest}
                  onChange={(e) => save({ dailyDigest: e.target.checked })}
                  disabled={busy}
                  className="mt-1 h-4 w-4 accent-ink"
                />
                <div>
                  <div className="text-sm font-medium text-ink">Send me a daily digest</div>
                  <div className="text-xs text-ink-muted mt-0.5">
                    One email per day grouping all open findings. We skip the email when nothing
                    at-or-above your severity threshold is open.
                  </div>
                </div>
              </label>
              <div>
                <label className="label">Minimum severity for digest</label>
                <select
                  className="input max-w-xs"
                  value={prefs.digestMinSeverity}
                  onChange={(e) => save({ digestMinSeverity: e.target.value as Severity })}
                  disabled={busy || !prefs.dailyDigest}
                >
                  <option value="info">Info — anything new</option>
                  <option value="watch">Watch (default) — worth a look</option>
                  <option value="critical">Critical only — only page me</option>
                </select>
              </div>
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-ink mb-3">Per-category delivery cadence</h3>
            <p className="text-xs text-ink-muted mb-4">
              Override the global cadence per category. "Daily" sends every ~24h, "weekly"
              every ~7d, "never" skips delivery entirely (findings still appear in the inbox).
            </p>
            <div className="rounded-xl border border-ink/8 bg-white divide-y divide-ink/5">
              {prefs.availableCategories.map((cat) => {
                const muted = prefs.mutedCategories.includes(cat);
                const freq = (prefs.categoryFrequency[cat] ?? (prefs.dailyDigest ? "daily" : "never")) as CatFreq;
                return (
                  <div key={cat} className={`flex items-center gap-3 px-4 py-3 ${muted ? "opacity-50" : ""}`}>
                    <div className="flex-1 min-w-0 text-sm font-medium text-ink">{cat}</div>
                    <select
                      className="input input-sm max-w-[140px]"
                      value={freq}
                      disabled={busy || muted}
                      onChange={(e) => setCategoryFrequency(cat, e.target.value as CatFreq)}
                    >
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="never">Never</option>
                    </select>
                  </div>
                );
              })}
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-ink mb-3">Slack / Teams webhook (optional)</h3>
            <p className="text-xs text-ink-muted mb-4">
              Deliver the digest to a chat channel alongside the email. Paste an incoming-webhook URL from
              Slack ("Incoming Webhooks" app) or Microsoft Teams ("Incoming Webhook" connector).
            </p>
            <div className="grid grid-cols-[1fr_200px] gap-3">
              <div>
                <label className="label">Webhook URL</label>
                <input
                  className="input"
                  type="url"
                  placeholder="https://hooks.slack.com/services/…"
                  value={prefs.webhookUrl ?? ""}
                  onChange={(e) => save({ webhookUrl: e.target.value.trim() ? e.target.value.trim() : null })}
                  disabled={busy}
                />
              </div>
              <div>
                <label className="label">Format</label>
                <select
                  className="input"
                  value={prefs.webhookType ?? "slack"}
                  onChange={(e) => save({ webhookType: e.target.value as "slack" | "teams" | "generic" })}
                  disabled={busy || !prefs.webhookUrl}
                >
                  <option value="slack">Slack</option>
                  <option value="teams">Microsoft Teams</option>
                  <option value="generic">Generic JSON</option>
                </select>
              </div>
            </div>
          </section>

          {tenantCfg !== null && (
            <section>
              <h3 className="text-sm font-semibold text-ink mb-3">LLM pattern-match prompt (tenant-level)</h3>
              <p className="text-xs text-ink-muted mb-4">
                Advanced: tune the system prompt the AI uses to generate soft-signal findings for your
                business. Leave blank to use the default. Only takes effect when <code className="font-mono text-[11px]">AI_INBOX_LLM_GENERATOR=1</code> is set.
              </p>
              <textarea
                className="input font-mono text-xs"
                rows={10}
                value={tenantCfgDraft}
                onChange={(e) => setTenantCfgDraft(e.target.value)}
                placeholder="You are an operations analyst reviewing a company's ERP snapshot…"
              />
              <div className="mt-3 flex items-center gap-2">
                <Button variant="brand" type="button" disabled={busy} onClick={saveTenantConfig}>
                  {busy ? "Saving…" : "Save prompt"}
                </Button>
                {tenantCfgDraft && (
                  <Button variant="secondary" type="button" disabled={busy} onClick={() => { setTenantCfgDraft(""); void saveTenantConfig(); }}>
                    Reset to default
                  </Button>
                )}
              </div>
            </section>
          )}

          <section>
            <h3 className="text-sm font-semibold text-ink mb-3">Advanced</h3>
            <div className="text-xs text-ink-muted">
              The AI Inbox scanner runs every few hours; preferences take effect on the next
              page load. Visit <a href="/ai-inbox" className="underline">/ai-inbox</a> to review
              findings right now.
            </div>
          </section>
        </div>
      )}
    </AppShell>
  );
}
