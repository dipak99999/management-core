"use client";

import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import {
  Button,
  Card,
  CardHeader,
  FormField,
  PageHeader,
  Segmented,
  Toast,
} from "../../../components/ui";

// SalesIQ widget appearance & behavior. LHS = form, RHS = live-updating
// preview using the same values the operator is editing. Above: an embed
// snippet with a Copy button; below: a link to the demo page.

type Position = "bottom-right" | "bottom-left";

interface Settings {
  brandName: string;
  greeting: string;
  primaryColor: string;
  position: Position;
  botEnabled: boolean;
  offlineMessage: string;
}

const DEFAULTS: Settings = {
  brandName: "Lumaara",
  greeting: "Hi there! How can we help?",
  primaryColor: "#7C3AED",
  position: "bottom-right",
  botEnabled: true,
  offlineMessage: "We're offline right now — leave a message and we'll reply.",
};

// Public-facing widget host. Prefer NEXT_PUBLIC_CRM_PUBLIC_URL (the
// external hostname operators embed on their site), fall back to the
// service URL. Tenant slug is read at render time from the signed-in
// session so multi-tenant deployments don't need per-tenant env vars.
const CRM_URL = process.env.NEXT_PUBLIC_CRM_PUBLIC_URL
  ?? process.env.NEXT_PUBLIC_CRM_SERVICE_URL
  ?? "/api/crm";

function currentTenantSlug(): string {
  if (typeof window === "undefined") return "demo";
  try {
    const raw = window.localStorage.getItem("lumaara.session");
    if (!raw) return "demo";
    const s = JSON.parse(raw) as { tenant?: { slug?: string } };
    return s.tenant?.slug ?? "demo";
  } catch {
    return "demo";
  }
}

export default function WidgetSettingsPage() {
  const [form, setForm] = useState<Settings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Compute in effect so we don't run localStorage during SSR.
  const [tenantSlug, setTenantSlug] = useState("demo");
  useEffect(() => setTenantSlug(currentTenantSlug()), []);
  const EMBED_SNIPPET = `<script src="${CRM_URL}/siq/widget.js?tenant=${tenantSlug}" defer></script>`;
  const DEMO_URL = `${CRM_URL}/siq/demo?tenant=${tenantSlug}`;
  const [toast, setToast] = useState<{
    kind: "info" | "success" | "error";
    message: string;
  } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const s = await api.get<Partial<Settings>>(`/siq/settings`);
        setForm({ ...DEFAULTS, ...s });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load settings");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      await api.put(`/siq/settings`, form);
      setToast({ kind: "success", message: "Widget settings saved." });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function copyEmbed() {
    try {
      await navigator.clipboard.writeText(EMBED_SNIPPET);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Clipboard access denied.");
    }
  }

  const initial = (form.brandName || "L").trim().charAt(0).toUpperCase();
  const bubbleSide =
    form.position === "bottom-left" ? "start-4" : "end-4";
  const chatSide =
    form.position === "bottom-left" ? "start-4" : "end-4";

  return (
    <>
      <PageHeader
        title="SalesIQ Widget"
        subtitle="Configure the on-site chat widget your visitors see."
      />

      {error && (
        <div className="mb-4">
          <Toast kind="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}
      {toast && (
        <div className="mb-4">
          <Toast
            kind={toast.kind}
            message={toast.message}
            onDismiss={() => setToast(null)}
          />
        </div>
      )}

      <div className="space-y-6">
        {/* ── Embed snippet ─────────────────────────────────────────── */}
        <Card>
          <CardHeader
            title="Install snippet"
            subtitle="Paste this before </body> on every page that should show the widget."
            actions={
              <Button variant="secondary" onClick={copyEmbed}>
                {copied ? "Copied!" : "Copy"}
              </Button>
            }
          />
          <div className="p-4">
            <pre className="bg-surface-sunken border border-ink-muted/10 rounded-lg p-3 text-xs font-mono text-ink-soft overflow-x-auto whitespace-pre-wrap break-all">
              {EMBED_SNIPPET}
            </pre>
          </div>
        </Card>

        {/* ── Form + live preview ───────────────────────────────────── */}
        <Card>
          <CardHeader
            title="Appearance & behavior"
            subtitle="Changes preview live on the right. Click Save to publish."
          />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-4">
            {/* Form (LEFT) */}
            <form onSubmit={save} className="space-y-4">
              <FormField label="Brand name" required>
                <input
                  required
                  className="input"
                  value={form.brandName}
                  onChange={(e) =>
                    setForm({ ...form, brandName: e.target.value })
                  }
                  disabled={loading}
                />
              </FormField>
              <FormField label="Greeting message">
                <input
                  className="input"
                  value={form.greeting}
                  onChange={(e) =>
                    setForm({ ...form, greeting: e.target.value })
                  }
                  disabled={loading}
                />
              </FormField>
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Primary color">
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      className="h-9 w-12 rounded border border-ink-muted/20 cursor-pointer bg-white"
                      value={form.primaryColor}
                      onChange={(e) =>
                        setForm({ ...form, primaryColor: e.target.value })
                      }
                      disabled={loading}
                    />
                    <input
                      className="input flex-1 font-mono text-xs"
                      value={form.primaryColor}
                      onChange={(e) =>
                        setForm({ ...form, primaryColor: e.target.value })
                      }
                      disabled={loading}
                    />
                  </div>
                </FormField>
                <FormField label="Position">
                  <div>
                    <Segmented<Position>
                      value={form.position}
                      onChange={(v) => setForm({ ...form, position: v })}
                      options={[
                        { value: "bottom-right", label: "Bottom right" },
                        { value: "bottom-left", label: "Bottom left" },
                      ]}
                    />
                  </div>
                </FormField>
              </div>
              <FormField label="Offline message">
                <textarea
                  className="input"
                  rows={3}
                  value={form.offlineMessage}
                  onChange={(e) =>
                    setForm({ ...form, offlineMessage: e.target.value })
                  }
                  disabled={loading}
                />
              </FormField>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  className="rounded"
                  checked={form.botEnabled}
                  onChange={(e) =>
                    setForm({ ...form, botEnabled: e.target.checked })
                  }
                  disabled={loading}
                />
                <span>Enable AI bot for the first response</span>
              </label>
              <div className="flex items-center gap-2 pt-2">
                <Button
                  type="submit"
                  variant="brand"
                  disabled={loading || saving}
                >
                  {saving ? "Saving…" : "Save changes"}
                </Button>
                <a
                  href={DEMO_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-secondary"
                >
                  Preview demo page
                </a>
              </div>
            </form>

            {/* Preview (RIGHT) */}
            <div>
              <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium mb-2">
                Live preview
              </div>
              <div className="relative rounded-xl border border-ink-muted/10 bg-surface-sunken h-[420px] overflow-hidden">
                {/* Faux page backdrop */}
                <div className="absolute inset-0 grid place-items-center text-ink-muted/40 text-xs">
                  your website
                </div>

                {/* Chat panel */}
                <div
                  className={`absolute bottom-20 ${chatSide} w-72 rounded-2xl bg-white shadow-brand-glow border border-ink-muted/10 overflow-hidden`}
                >
                  <div
                    className="px-4 py-3 text-white"
                    style={{ backgroundColor: form.primaryColor }}
                  >
                    <div className="text-sm font-semibold">
                      {form.brandName || "Brand"}
                    </div>
                    <div className="text-[11px] opacity-90">
                      We typically reply in a few minutes
                    </div>
                  </div>
                  <div className="p-3 bg-surface-sunken min-h-[120px]">
                    <div className="flex items-start gap-2">
                      <span
                        className="h-7 w-7 rounded-full grid place-items-center text-white text-xs font-bold shrink-0"
                        style={{ backgroundColor: form.primaryColor }}
                      >
                        {initial}
                      </span>
                      <div className="bg-white rounded-2xl rounded-tl-md px-3 py-2 text-sm text-ink border border-ink-muted/10 max-w-[85%]">
                        {form.greeting || "Hi there!"}
                      </div>
                    </div>
                  </div>
                  <div className="border-t border-ink-muted/10 px-3 py-2 text-xs text-ink-muted">
                    Type a message…
                  </div>
                </div>

                {/* Bubble button */}
                <button
                  type="button"
                  className={`absolute bottom-4 ${bubbleSide} h-12 w-12 rounded-full text-white shadow-brand-glow grid place-items-center`}
                  style={{ backgroundColor: form.primaryColor }}
                  aria-label="Preview chat bubble"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M4 5h16v11H8l-4 4V5z"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>
              {!form.botEnabled && (
                <div className="mt-2 text-[11px] text-ink-muted">
                  Bot is disabled — visitors go straight to the operator queue.
                </div>
              )}
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
