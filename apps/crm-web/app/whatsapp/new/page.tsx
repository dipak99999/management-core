"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "../../../lib/api";
import {
  Button,
  Card,
  FormField,
  PageHeader,
  SectionHeader,
  Toast,
} from "../../../components/ui";

interface WhatsappTemplate {
  id: string;
  name: string;
  category: string;
  status: string;
  language: string;
  headerType: string | null;
  headerText: string | null;
  bodyText: string;
  footerText: string | null;
  variables: string[] | null;
}

const E164_RE = /^\+[1-9]\d{7,14}$/;
function normalizeE164(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const plus = trimmed.startsWith("+") ? "+" : "";
  return plus + trimmed.replace(/[^\d]/g, "");
}

// WABA templates use positional variables: {{1}}, {{2}}, ...
function extractPositionalVars(body: string): string[] {
  const nums = new Set<number>();
  for (const m of body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) nums.add(Number(m[1]));
  return [...nums].sort((a, b) => a - b).map(String);
}

function renderPositional(body: string, values: Record<string, string>): string {
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, k) => {
    const v = values[k];
    return v && v.length > 0 ? v : `{{${k}}}`;
  });
}

function InnerWhatsappSendPage() {
  const sp = useSearchParams();
  const [templates, setTemplates] = useState<WhatsappTemplate[]>([]);
  const [templateId, setTemplateId] = useState<string>("");
  const [to, setTo] = useState(sp.get("to") ?? "");
  const [vars, setVars] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<WhatsappTemplate[]>("/whatsapp/templates")
      .then((rows) => setTemplates(rows.filter((t) => t.status === "APPROVED")))
      .catch(() => setTemplates([]));
  }, []);

  const template = templates.find((t) => t.id === templateId) ?? null;
  const positional = useMemo(
    () => (template ? extractPositionalVars(template.bodyText) : []),
    [template],
  );
  const preview = template
    ? renderPositional(template.bodyText, vars)
    : "";

  const toNormalized = normalizeE164(to);
  const toValid = E164_RE.test(toNormalized);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (!toValid) {
      setError("Enter a valid E.164 mobile number (e.g. +919876543210)");
      return;
    }
    if (!template) {
      setError("Pick a Meta-approved template.");
      return;
    }
    for (const k of positional) {
      if (!vars[k] || !vars[k].trim()) {
        setError(`Provide a value for {{${k}}}`);
        return;
      }
    }
    setSaving(true);
    try {
      await api.post("/whatsapp/send", {
        toMobile: toNormalized,
        templateId: template.id,
        vars,
      });
      setNotice("WhatsApp message queued.");
      setTimeout(() => {
        window.location.href = "/crm/whatsapp";
      }, 700);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Send failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        breadcrumb={[
          { label: "WhatsApp", href: "/crm/whatsapp" },
          { label: "New" },
        ]}
        title="New WhatsApp message"
        subtitle="Send via a Meta-approved template. Freeform replies are only allowed inside the 24-hour customer-care window (use Inbox)."
        actions={
          <>
            <Button
              variant="secondary"
              type="button"
              onClick={() => history.back()}
            >
              ← Back
            </Button>
            <Button
              variant="brand"
              type="button"
              disabled={saving || !toValid || !template}
              onClick={(e) => send(e as unknown as React.FormEvent)}
            >
              {saving ? "Sending…" : "Send"}
            </Button>
          </>
        }
      />

      {notice && (
        <div className="mb-4">
          <Toast
            kind="success"
            message={notice}
            onDismiss={() => setNotice(null)}
          />
        </div>
      )}
      {error && (
        <div className="mb-4">
          <Toast
            kind="error"
            message={error}
            onDismiss={() => setError(null)}
          />
        </div>
      )}

      <form onSubmit={send} className="grid grid-cols-2 gap-4">
        <Card className="p-5 space-y-4">
          <SectionHeader title="Compose" />

          <FormField
            label="To (mobile number)"
            required
            hint="Use E.164 with the leading + and country code."
            error={to && !toValid ? "Not a valid E.164 number" : undefined}
          >
            <input
              className="input font-mono"
              placeholder="+919876543210"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              onBlur={() => setTo(normalizeE164(to))}
              autoFocus
              inputMode="tel"
            />
          </FormField>

          <FormField
            label="Template"
            required
            hint={
              templates.length === 0
                ? "No approved templates yet. Create one under Templates and wait for Meta approval."
                : "Only APPROVED templates are shown."
            }
          >
            <select
              className="input"
              value={templateId}
              onChange={(e) => {
                setTemplateId(e.target.value);
                setVars({});
              }}
              required
            >
              <option value="">— Select a template —</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} · {t.language} · {t.category}
                </option>
              ))}
            </select>
          </FormField>

          {template && positional.length > 0 && (
            <div className="space-y-3">
              <div className="text-xs uppercase tracking-wider text-ink-muted font-semibold">
                Template variables
              </div>
              {positional.map((n, i) => {
                const named = template.variables?.[i];
                return (
                  <FormField key={n} label={named ? `{{${n}}} — ${named}` : `{{${n}}}`}>
                    <input
                      className="input"
                      placeholder={`Value for {{${n}}}`}
                      value={vars[n] ?? ""}
                      onChange={(e) =>
                        setVars((prev) => ({ ...prev, [n]: e.target.value }))
                      }
                    />
                  </FormField>
                );
              })}
            </div>
          )}

          <button type="submit" className="hidden" />
        </Card>

        <Card className="p-5 space-y-3">
          <SectionHeader title="Preview" />
          {template ? (
            <div className="rounded-2xl border border-ink-muted/10 bg-white p-0 overflow-hidden shadow-sm max-w-sm">
              {template.headerText && (
                <div className="px-4 pt-3 pb-1 font-semibold text-ink text-sm">
                  {template.headerText}
                </div>
              )}
              <div className="px-4 py-3 text-sm text-ink whitespace-pre-wrap">
                {preview}
              </div>
              {template.footerText && (
                <div className="px-4 pb-3 text-[11px] text-ink-muted">
                  {template.footerText}
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-lg border border-ink-muted/10 bg-surface-sunken p-4 text-sm text-ink-muted italic min-h-[160px]">
              Select a template to preview the rendered message.
            </div>
          )}
          {template && (
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-ink-muted">
                  Category
                </div>
                <div className="font-medium mt-0.5 text-ink">
                  {template.category}
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-ink-muted">
                  Language
                </div>
                <div className="font-medium mt-0.5 text-ink">
                  {template.language}
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-ink-muted">
                  Status
                </div>
                <div className="font-medium mt-0.5 text-green-700">
                  {template.status}
                </div>
              </div>
            </div>
          )}
        </Card>
      </form>
    </>
  );
}

export default function WhatsappSendPage() {
  return (
    <Suspense fallback={null}>
      <InnerWhatsappSendPage />
    </Suspense>
  );
}
