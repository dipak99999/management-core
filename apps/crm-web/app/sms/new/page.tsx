"use client";

import { useEffect, useMemo, useState } from "react";
import { smsApi } from "../../../lib/sms-api";
import {
  Button,
  Card,
  FormField,
  PageHeader,
  SectionHeader,
  Toast,
} from "../../../components/ui";

interface SmsTemplate {
  id: string;
  name: string;
  body: string;
  enabled: boolean;
}

// GSM-7 (default 3GPP alphabet). Everything outside this set forces UCS-2
// which halves the per-segment budget.
const GSM7 = new Set(
  [
    ..."@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà",
  ].map((c) => c.codePointAt(0)!),
);
// Extended GSM chars each count as 2 septets.
const GSM7_EXT = new Set(
  [...`^{}\\[~]|€`].map((c) => c.codePointAt(0)!),
);

// Encoding + segmentation math per 3GPP TS 23.038 / 23.040.
// - GSM-7 single: 160, concat: 153 chars per segment (7 bits stolen for UDH).
// - UCS-2  single: 70,  concat: 67  chars per segment (16-bit code units).
function analyze(body: string): {
  encoding: "GSM-7" | "UCS-2";
  units: number;
  perSegment: number;
  segments: number;
  remainingInSegment: number;
} {
  let ucs2 = false;
  let units = 0;
  for (const ch of body) {
    const cp = ch.codePointAt(0)!;
    if (GSM7.has(cp)) units += 1;
    else if (GSM7_EXT.has(cp)) units += 2;
    else {
      ucs2 = true;
      break;
    }
  }
  if (ucs2) {
    // For UCS-2 count 16-bit code units; a surrogate pair (emoji) is 2 units.
    units = [...body].reduce(
      (n, ch) => n + (ch.codePointAt(0)! > 0xffff ? 2 : 1),
      0,
    );
  }
  const encoding = ucs2 ? "UCS-2" : "GSM-7";
  const single = encoding === "GSM-7" ? 160 : 70;
  const perSegment = encoding === "GSM-7" ? 153 : 67;
  const segments =
    units === 0 ? 0 : units <= single ? 1 : Math.ceil(units / perSegment);
  const capacity = segments <= 1 ? single : segments * perSegment;
  return {
    encoding,
    units,
    perSegment,
    segments,
    remainingInSegment: Math.max(0, capacity - units),
  };
}

// E.164 loosely: leading "+" then 8–15 digits. Non-digits after "+" get
// stripped by the format helper.
const E164_RE = /^\+[1-9]\d{7,14}$/;
function normalizeE164(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const plus = trimmed.startsWith("+") ? "+" : "";
  return plus + trimmed.replace(/[^\d]/g, "");
}

// Replace {{var}} tokens with matching values, leaving unknowns visible so
// the user notices unfilled slots.
function renderPreview(body: string, vars: Record<string, string>): string {
  return body.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, k) => {
    const v = vars[k];
    return v && v.length > 0 ? v : `{{${k}}}`;
  });
}

function extractVars(body: string): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) out.add(m[1]);
  return [...out];
}

export default function SmsComposePage() {
  const [templates, setTemplates] = useState<SmsTemplate[]>([]);
  const [templateId, setTemplateId] = useState<string>("");
  const [to, setTo] = useState("");
  const [body, setBody] = useState("");
  const [vars, setVars] = useState<Record<string, string>>({});
  const [scheduledFor, setScheduledFor] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    smsApi
      .get<SmsTemplate[]>("/sms-templates")
      .then((rows) => setTemplates(rows.filter((r) => r.enabled)))
      .catch(() => setTemplates([]));
  }, []);

  const template = templates.find((t) => t.id === templateId) ?? null;
  const templateVars = useMemo(
    () => (template ? extractVars(template.body) : []),
    [template],
  );
  const previewBody = template ? renderPreview(template.body, vars) : body;
  const metrics = useMemo(() => analyze(previewBody), [previewBody]);
  const toNormalized = normalizeE164(to);
  const toValid = E164_RE.test(toNormalized);

  async function send(action: "now" | "schedule") {
    setError(null);
    setNotice(null);
    if (!toValid) {
      setError("Enter a valid E.164 mobile number (e.g. +919876543210)");
      return;
    }
    if (action === "schedule" && !scheduledFor) {
      setError("Pick a schedule time (or use Send now)");
      return;
    }
    setSaving(true);
    try {
      const scheduledIso =
        action === "schedule" && scheduledFor
          ? new Date(scheduledFor).toISOString()
          : null;
      if (template) {
        await smsApi.post("/sms/send-from-template", {
          templateId: template.id,
          toMobile: toNormalized,
          vars,
          scheduledFor: scheduledIso,
        });
      } else {
        if (!body.trim()) {
          setError("Enter a message body or pick a template.");
          setSaving(false);
          return;
        }
        await smsApi.post("/sms/send", {
          toMobile: toNormalized,
          body,
          scheduledFor: scheduledIso,
        });
      }
      setNotice(
        action === "schedule"
          ? "Message scheduled. It will send at the chosen time."
          : "Message queued for immediate delivery.",
      );
      // Small delay so the toast is visible before we navigate away.
      setTimeout(() => {
        window.location.href = "/crm/sms";
      }, 700);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Send failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        breadcrumb={[
          { label: "SMS", href: "/crm/sms" },
          { label: "New" },
        ]}
        title="New SMS"
        subtitle="Compose a one-off SMS or send from a template."
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
              variant="secondary"
              type="button"
              disabled={saving}
              onClick={() => send("schedule")}
            >
              Schedule
            </Button>
            <Button
              variant="brand"
              type="button"
              disabled={saving || !toValid}
              onClick={() => send("now")}
            >
              {saving ? "Sending…" : "Send now"}
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

      <div className="grid grid-cols-2 gap-4">
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

          <FormField label="Template (optional)">
            <select
              className="input"
              value={templateId}
              onChange={(e) => {
                setTemplateId(e.target.value);
                setVars({});
              }}
            >
              <option value="">— No template (freeform body) —</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </FormField>

          {!template && (
            <FormField
              label="Body"
              required={!template}
              hint={`${metrics.encoding} · ${metrics.units} chars · ${metrics.segments} segment${metrics.segments === 1 ? "" : "s"} · ${metrics.remainingInSegment} free in this segment`}
            >
              <textarea
                className="input"
                rows={5}
                placeholder="Hi {{name}}, your OTP is …"
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </FormField>
          )}

          {template && templateVars.length > 0 && (
            <div className="space-y-3">
              <div className="text-xs uppercase tracking-wider text-ink-muted font-semibold">
                Template variables
              </div>
              {templateVars.map((v) => (
                <FormField key={v} label={v}>
                  <input
                    className="input"
                    placeholder={`Value for {{${v}}}`}
                    value={vars[v] ?? ""}
                    onChange={(e) =>
                      setVars((prev) => ({ ...prev, [v]: e.target.value }))
                    }
                  />
                </FormField>
              ))}
            </div>
          )}

          <FormField
            label="Schedule for (optional)"
            hint="Leave empty to send immediately."
          >
            <input
              type="datetime-local"
              className="input"
              value={scheduledFor}
              onChange={(e) => setScheduledFor(e.target.value)}
            />
          </FormField>
        </Card>

        <Card className="p-5 space-y-3">
          <SectionHeader title="Preview" />
          <div className="rounded-lg border border-ink-muted/10 bg-surface-sunken p-4 min-h-[160px] text-sm whitespace-pre-wrap text-ink">
            {previewBody || (
              <span className="text-ink-muted italic">
                Message preview will appear here.
              </span>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-ink-muted">
                Encoding
              </div>
              <div className="font-medium tabular-nums text-ink mt-0.5">
                {metrics.encoding}
              </div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-ink-muted">
                Length
              </div>
              <div className="font-medium tabular-nums text-ink mt-0.5">
                {metrics.units} chars
              </div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-ink-muted">
                Segments
              </div>
              <div
                className={`font-medium tabular-nums mt-0.5 ${metrics.segments > 1 ? "text-amber-700" : "text-ink"}`}
              >
                {metrics.segments}
              </div>
            </div>
          </div>
          <div className="text-[11px] text-ink-muted">
            Per-segment budget: {metrics.encoding === "GSM-7" ? "160 single · 153 concat" : "70 single · 67 concat"}.
            Longer messages are split and re-assembled by the carrier — each
            segment is billed separately.
          </div>
        </Card>
      </div>
    </>
  );
}
