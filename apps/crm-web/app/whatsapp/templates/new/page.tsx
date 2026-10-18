"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "../../../../lib/api";
import {
  Button,
  Card,
  Drawer,
  FormField,
  PageHeader,
  SectionHeader,
  Toast,
} from "../../../../components/ui";

type Category = "MARKETING" | "UTILITY" | "AUTHENTICATION";
type HeaderType = "none" | "TEXT" | "IMAGE";

// Meta template names: lowercase letters, digits, underscore. 512 char max.
const NAME_RE = /^[a-z0-9_]+$/;

function countPositionalVars(body: string): number {
  const nums = new Set<number>();
  for (const m of body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) nums.add(Number(m[1]));
  return nums.size;
}
function positionalNumbers(body: string): number[] {
  const nums = new Set<number>();
  for (const m of body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) nums.add(Number(m[1]));
  return [...nums].sort((a, b) => a - b);
}

export default function WhatsappTemplateCreatePage() {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<Category>("MARKETING");
  const [language, setLanguage] = useState("en_US");
  const [headerType, setHeaderType] = useState<HeaderType>("none");
  const [headerText, setHeaderText] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [footerText, setFooterText] = useState("");
  const [variableNames, setVariableNames] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // ── P3: AI rewrite for the body text ────────────────────────────────
  const [showAi, setShowAi] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiTone, setAiTone] = useState<
    "casual" | "formal" | "friendly" | "urgent" | "shorter" | "longer"
  >("friendly");
  const [aiRewrite, setAiRewrite] = useState("");

  async function runAiRewrite() {
    if (!bodyText.trim()) {
      setError("Add some body text first, then use AI to rewrite it.");
      return;
    }
    setAiBusy(true);
    setAiRewrite("");
    try {
      const r = await api.post<{ rewritten: string }>("/ai-assist/rewrite", {
        text: bodyText,
        tone: aiTone,
      });
      // Strip any HTML the model produced — WhatsApp template body is plain
      // text (Meta rejects HTML in template bodies) with positional {{n}} vars.
      const plain = r.rewritten.replace(/<[^>]+>/g, "").trim();
      setAiRewrite(plain);
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI rewrite failed");
    } finally {
      setAiBusy(false);
    }
  }

  function applyAiRewrite() {
    if (!aiRewrite) return;
    setBodyText(aiRewrite);
    setShowAi(false);
    setNotice("Body text updated from AI rewrite.");
  }

  const positional = useMemo(() => positionalNumbers(bodyText), [bodyText]);
  const varCount = countPositionalVars(bodyText);

  // Keep variableNames array in sync with the detected positional count.
  useEffect(() => {
    setVariableNames((prev) => {
      if (prev.length === varCount) return prev;
      const out = [...prev];
      while (out.length < varCount) out.push("");
      out.length = varCount;
      return out;
    });
  }, [varCount]);

  const nameValid = name.length > 0 && NAME_RE.test(name);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (!nameValid) {
      setError(
        "Name must be lowercase letters, digits and underscores only (a–z, 0–9, _).",
      );
      return;
    }
    if (!bodyText.trim()) {
      setError("Body text is required.");
      return;
    }
    if (headerType === "TEXT" && !headerText.trim()) {
      setError("Header text is required when Header type is TEXT.");
      return;
    }
    setSaving(true);
    try {
      await api.post("/whatsapp/templates", {
        name,
        category,
        language,
        headerType: headerType === "none" ? null : headerType,
        headerText: headerType === "TEXT" ? headerText : null,
        bodyText,
        footerText: footerText || null,
        variables: variableNames,
      });
      setNotice("Template submitted. Meta review typically takes a few minutes.");
      setTimeout(() => {
        window.location.href = "/crm/whatsapp/templates";
      }, 900);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create template");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        breadcrumb={[
          { label: "WhatsApp", href: "/crm/whatsapp" },
          { label: "Templates", href: "/crm/whatsapp/templates" },
          { label: "New" },
        ]}
        title="New WhatsApp template"
        subtitle="Meta will review the template before it can be sent. Marketing templates take the longest; utility + auth are usually faster."
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
              disabled={saving}
              onClick={(e) => save(e as unknown as React.FormEvent)}
            >
              {saving ? "Submitting…" : "Submit for approval"}
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

      <form onSubmit={save} className="grid grid-cols-2 gap-4">
        <Card className="p-5 space-y-4">
          <SectionHeader title="Template" />

          <FormField
            label="Name"
            required
            hint="Lowercase letters, digits and underscores. Must be unique in the tenant + language pair."
            error={name && !nameValid ? "Invalid template name" : undefined}
          >
            <input
              className="input font-mono"
              placeholder="order_shipped_v1"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              required
            />
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Category" required>
              <select
                className="input"
                value={category}
                onChange={(e) => setCategory(e.target.value as Category)}
              >
                <option value="MARKETING">MARKETING</option>
                <option value="UTILITY">UTILITY</option>
                <option value="AUTHENTICATION">AUTHENTICATION</option>
              </select>
            </FormField>
            <FormField
              label="Language"
              required
              hint="Meta locale code (en_US, en, hi, es, de, …)"
            >
              <select
                className="input"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
              >
                <option>en_US</option>
                <option>en</option>
                <option>en_GB</option>
                <option>hi</option>
                <option>es</option>
                <option>es_MX</option>
                <option>de</option>
                <option>fr</option>
                <option>pt_BR</option>
                <option>id</option>
                <option>ar</option>
                <option>ja</option>
              </select>
            </FormField>
          </div>

          <FormField label="Header type">
            <select
              className="input"
              value={headerType}
              onChange={(e) => setHeaderType(e.target.value as HeaderType)}
            >
              <option value="none">None</option>
              <option value="TEXT">Text</option>
              <option value="IMAGE">Image</option>
            </select>
          </FormField>

          {headerType === "TEXT" && (
            <FormField label="Header text" required hint="Up to 60 characters.">
              <input
                className="input"
                maxLength={60}
                placeholder="Your order has shipped"
                value={headerText}
                onChange={(e) => setHeaderText(e.target.value)}
              />
            </FormField>
          )}
          {headerType === "IMAGE" && (
            <div className="text-[11px] text-ink-muted -mt-2">
              Image headers are attached at send time via Meta media ID.
              Upload/attach flow is handled by the backend once implemented.
            </div>
          )}

          <FormField
            label="Body text"
            required
            hint={`Use positional {{1}}, {{2}}, ... variables. Detected: ${varCount} variable${varCount === 1 ? "" : "s"} (${positional.map((n) => `{{${n}}}`).join(", ") || "none"}).`}
          >
            <textarea
              className="input"
              rows={5}
              placeholder="Hi {{1}}, your order {{2}} is on the way."
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
              required
            />
          </FormField>
          <div className="flex justify-end -mt-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setShowAi(true)}
              disabled={!bodyText.trim()}
            >
              ✨ AI Rewrite
            </Button>
          </div>

          <FormField label="Footer text" hint="Up to 60 characters. Optional.">
            <input
              className="input"
              maxLength={60}
              placeholder="Reply STOP to unsubscribe"
              value={footerText}
              onChange={(e) => setFooterText(e.target.value)}
            />
          </FormField>

          {varCount > 0 && (
            <div className="space-y-2">
              <div className="text-xs uppercase tracking-wider text-ink-muted font-semibold">
                Variable names (optional, shown to operator in composer)
              </div>
              {positional.map((n, i) => (
                <FormField key={n} label={`{{${n}}}`}>
                  <input
                    className="input"
                    placeholder={`Friendly name for {{${n}}} (e.g. customer_name)`}
                    value={variableNames[i] ?? ""}
                    onChange={(e) => {
                      const v = [...variableNames];
                      while (v.length <= i) v.push("");
                      v[i] = e.target.value;
                      setVariableNames(v);
                    }}
                  />
                </FormField>
              ))}
            </div>
          )}

          <button type="submit" className="hidden" />
        </Card>

        <Card className="p-5 space-y-3">
          <SectionHeader title="Preview" />
          <div className="rounded-2xl border border-ink-muted/10 bg-white p-0 overflow-hidden shadow-sm max-w-sm">
            {headerType === "TEXT" && headerText && (
              <div className="px-4 pt-3 pb-1 font-semibold text-ink text-sm">
                {headerText}
              </div>
            )}
            {headerType === "IMAGE" && (
              <div className="h-32 bg-surface-sunken flex items-center justify-center text-xs text-ink-muted border-b border-ink-muted/10">
                [image header]
              </div>
            )}
            <div className="px-4 py-3 text-sm text-ink whitespace-pre-wrap min-h-[64px]">
              {bodyText || (
                <span className="text-ink-muted italic">
                  Message body preview.
                </span>
              )}
            </div>
            {footerText && (
              <div className="px-4 pb-3 text-[11px] text-ink-muted">
                {footerText}
              </div>
            )}
          </div>
          <div className="text-[11px] text-ink-muted">
            Positional variables appear as literal <code>{`{{1}}`}</code> here.
            The composer will let the operator fill actual values at send time.
          </div>
        </Card>
      </form>

      {/* ── P3: AI Rewrite drawer ────────────────────────────────── */}
      <Drawer
        open={showAi}
        onClose={() => setShowAi(false)}
        title="✨ AI Rewrite"
        width="w-[560px]"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowAi(false)}>
              Close
            </Button>
            <Button variant="brand" onClick={runAiRewrite} disabled={aiBusy}>
              {aiBusy ? "Thinking…" : "Rewrite"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-xs text-ink-soft">
            Rewrites the body text in a different tone. The AI keeps
            positional <code>{`{{n}}`}</code> variables intact. WhatsApp
            template bodies are plain text — any HTML is stripped before
            applying.
          </p>
          <FormField label="Rewrite as">
            <select
              className="input"
              value={aiTone}
              onChange={(e) => setAiTone(e.target.value as typeof aiTone)}
            >
              <option value="friendly">More friendly</option>
              <option value="casual">More casual</option>
              <option value="formal">More formal</option>
              <option value="urgent">More urgent</option>
              <option value="shorter">Shorter</option>
              <option value="longer">Longer</option>
            </select>
          </FormField>
          {aiRewrite && (
            <>
              <div className="text-xs uppercase tracking-wider text-ink-muted font-semibold">
                Rewritten body
              </div>
              <Card>
                <div className="p-4 text-sm text-ink whitespace-pre-wrap">
                  {aiRewrite}
                </div>
              </Card>
              <Button variant="brand" onClick={applyAiRewrite}>
                Apply to body
              </Button>
            </>
          )}
        </div>
      </Drawer>
    </>
  );
}
