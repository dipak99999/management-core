"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "../../../../components/app-shell";
import { SHELL_NAV } from "../../../../components/shell-nav";
import {
  Button,
  Card,
  CardHeader,
  Drawer,
  FormField,
  PageHeader,
  Toast,
} from "../../../../components/ui";

// Admin brand kit page — two-column layout:
//   LEFT: editable form (colors, fonts, footer HTML, logo/favicon media pickers, socials)
//   RIGHT: iframe live preview served by /brand-kit/preview.html
// Below both: catalog of {{brand.*}} merge tags available in email templates.
//
// Data source: crm-service /brand-kit (GET auto-provisions defaults so the
// page never sees 404; PUT upserts). Same 401-auto-clear pattern as the
// media-library page.

const CRM_BASE =
  (typeof process !== "undefined" &&
    process.env.NEXT_PUBLIC_CRM_SERVICE_URL) ??
  "/api/crm";

interface BrandKitRow {
  id: string;
  tenantId: string;
  logoAssetId: string | null;
  faviconAssetId: string | null;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  neutralColor: string;
  headingFont: string;
  bodyFont: string;
  footerHtml: string | null;
  socialLinks: Record<string, string> | null;
  updatedAt: string;
}

interface MediaRow {
  id: string;
  filename: string;
  contentType: string;
  presignedUrl: string | null;
  folder: string;
  width: number | null;
  height: number | null;
}

function sessionToken(): string {
  if (typeof window === "undefined") return "";
  try {
    const raw = localStorage.getItem("lumaara.session");
    return raw ? (JSON.parse(raw).token as string) : "";
  } catch {
    return "";
  }
}

function clearSessionRedirect() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem("lumaara.session");
  } catch {
    /* ignore */
  }
  if (!window.location.pathname.startsWith("/login")) {
    window.location.href = "/login";
  }
}

async function crmFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = sessionToken();
  const res = await fetch(`${CRM_BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (res.status === 401 && token) clearSessionRedirect();
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  // Guard against HTML/text responses from upstream — raw JSON.parse
  // throws "Unexpected token 'I'" ("Internal Server Error") and buries
  // the real status + body.
  let data: unknown = null;
  if (text) {
    try { data = JSON.parse(text); }
    catch { throw new Error(`Expected JSON but got: ${text.slice(0, 120).replace(/\s+/g, " ")}`); }
  }
  if (!res.ok) {
    const err =
      data && typeof data === "object" && "error" in data
        ? typeof data.error === "string"
          ? data.error
          : JSON.stringify(data.error)
        : `${res.status} ${res.statusText}`;
    throw new Error(err);
  }
  return data as T;
}

// Debounce helper for the preview refresh — we don't want to hammer the
// preview endpoint on every keystroke.
function useDebounced<T>(value: T, delay: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

export default function BrandKitPage() {
  const [row, setRow] = useState<BrandKitRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: "success" | "info" | "error"; msg: string } | null>(
    null,
  );

  // Local editable draft. We only PUT on Save so an admin can bail out.
  const [draft, setDraft] = useState<Partial<BrandKitRow>>({});

  // Media picker state.
  const [pickerOpen, setPickerOpen] = useState<null | "logo" | "favicon">(null);
  const [pickerRows, setPickerRows] = useState<MediaRow[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");

  // Load the row (or the freshly-created default).
  useEffect(() => {
    (async () => {
      try {
        const r = await crmFetch<BrandKitRow>("/brand-kit");
        setRow(r);
        setDraft(r);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load brand kit");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Debounce the draft so the preview iframe doesn't re-fetch on every
  // keystroke. Save-then-preview would be nicer, but debounce is good enough
  // for a v1.
  const debouncedDraft = useDebounced(draft, 400);
  const previewSrc = useMemo(() => {
    // Preview reflects last SAVED state — we bump a cache-buster with the
    // draft's updatedAt shadow so it re-renders after a Save.
    const bust = row?.updatedAt ?? "init";
    // Include debouncedDraft so eslint sees the dep + we invalidate visually
    // when the user is editing (tell them "hit Save to refresh").
    const _ = debouncedDraft;
    void _;
    return `${CRM_BASE}/brand-kit/preview.html?bust=${encodeURIComponent(bust)}`;
  }, [row?.updatedAt, debouncedDraft]);

  async function save() {
    if (!row) return;
    setSaving(true);
    try {
      const patch: Partial<BrandKitRow> = {
        logoAssetId: draft.logoAssetId ?? row.logoAssetId,
        faviconAssetId: draft.faviconAssetId ?? row.faviconAssetId,
        primaryColor: draft.primaryColor ?? row.primaryColor,
        secondaryColor: draft.secondaryColor ?? row.secondaryColor,
        accentColor: draft.accentColor ?? row.accentColor,
        neutralColor: draft.neutralColor ?? row.neutralColor,
        headingFont: draft.headingFont ?? row.headingFont,
        bodyFont: draft.bodyFont ?? row.bodyFont,
        footerHtml: draft.footerHtml ?? row.footerHtml ?? "",
        socialLinks: draft.socialLinks ?? row.socialLinks ?? {},
      };
      // The PUT endpoint accepts these directly — auth token is injected by crmFetch.
      const updated = await crmFetch<BrandKitRow>("/brand-kit", {
        method: "PUT",
        body: JSON.stringify(patch),
      });
      setRow(updated);
      setDraft(updated);
      setToast({ kind: "success", msg: "Brand kit saved" });
    } catch (e) {
      setToast({ kind: "error", msg: e instanceof Error ? e.message : "Save failed" });
    } finally {
      setSaving(false);
    }
  }

  async function openPicker(kind: "logo" | "favicon") {
    setPickerOpen(kind);
    setPickerLoading(true);
    try {
      const list = await crmFetch<MediaRow[]>(
        `/media?limit=100${pickerSearch ? `&search=${encodeURIComponent(pickerSearch)}` : ""}`,
      );
      setPickerRows(list);
    } catch (e) {
      setToast({
        kind: "error",
        msg: e instanceof Error ? e.message : "Failed to load media",
      });
    } finally {
      setPickerLoading(false);
    }
  }

  function setDraftField<K extends keyof BrandKitRow>(key: K, value: BrandKitRow[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function setSocialLink(k: string, v: string) {
    setDraft((d) => ({
      ...d,
      socialLinks: { ...(d.socialLinks ?? row?.socialLinks ?? {}), [k]: v },
    }));
  }

  if (loading) {
    return (
      <AppShell moduleName="Home" nav={SHELL_NAV}>
        <PageHeader
          title="Loading…"
          breadcrumb={[
            { label: "Admin", href: "/admin" },
            { label: "Marketing", href: "/admin/marketing" },
            { label: "Brand kit" },
          ]}
        />
      </AppShell>
    );
  }
  if (error || !row) {
    return (
      <AppShell moduleName="Home" nav={SHELL_NAV}>
        <PageHeader
          title="Brand kit"
          breadcrumb={[
            { label: "Admin", href: "/admin" },
            { label: "Marketing", href: "/admin/marketing" },
            { label: "Brand kit" },
          ]}
        />
        <Card className="p-4 text-red-700 border-red-200 bg-red-50">
          {error ?? "No brand kit row"}
        </Card>
      </AppShell>
    );
  }

  const socials = (draft.socialLinks ?? row.socialLinks ?? {}) as Record<string, string>;

  return (
    <AppShell moduleName="Home" nav={SHELL_NAV}>
      <PageHeader
        title="Brand kit"
        subtitle="Colours, fonts, logo, and footer HTML applied to every email your team sends."
        breadcrumb={[
          { label: "Admin", href: "/admin" },
          { label: "Marketing", href: "/admin/marketing" },
          { label: "Brand kit" },
        ]}
        actions={
          <>
            <Button variant="secondary" onClick={() => history.back()}>
              ← Back
            </Button>
            <Button variant="primary" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </>
        }
      />

      {toast && (
        <div className="mb-4">
          <Toast kind={toast.kind} message={toast.msg} onDismiss={() => setToast(null)} />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* LEFT: form (3 cols) */}
        <div className="lg:col-span-3 space-y-4">
          <Card className="p-4">
            <CardHeader title="Colours" subtitle="Six-digit hex values, applied to buttons, headings, and links." />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <ColorField
                label="Primary"
                value={draft.primaryColor ?? row.primaryColor}
                onChange={(v) => setDraftField("primaryColor", v)}
              />
              <ColorField
                label="Secondary"
                value={draft.secondaryColor ?? row.secondaryColor}
                onChange={(v) => setDraftField("secondaryColor", v)}
              />
              <ColorField
                label="Accent"
                value={draft.accentColor ?? row.accentColor}
                onChange={(v) => setDraftField("accentColor", v)}
              />
              <ColorField
                label="Neutral (text)"
                value={draft.neutralColor ?? row.neutralColor}
                onChange={(v) => setDraftField("neutralColor", v)}
              />
            </div>
          </Card>

          <Card className="p-4">
            <CardHeader title="Typography" subtitle="CSS font-family strings — e.g. 'Inter, sans-serif'." />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FormField label="Heading font" required>
                <input
                  className="input"
                  value={draft.headingFont ?? row.headingFont}
                  onChange={(e) => setDraftField("headingFont", e.target.value)}
                />
              </FormField>
              <FormField label="Body font" required>
                <input
                  className="input"
                  value={draft.bodyFont ?? row.bodyFont}
                  onChange={(e) => setDraftField("bodyFont", e.target.value)}
                />
              </FormField>
            </div>
          </Card>

          <Card className="p-4">
            <CardHeader title="Media" subtitle="Logo + favicon pulled from the media library." />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <MediaPickerField
                label="Logo"
                assetId={draft.logoAssetId ?? row.logoAssetId}
                onPick={() => openPicker("logo")}
                onClear={() => setDraftField("logoAssetId", null)}
              />
              <MediaPickerField
                label="Favicon"
                assetId={draft.faviconAssetId ?? row.faviconAssetId}
                onPick={() => openPicker("favicon")}
                onClear={() => setDraftField("faviconAssetId", null)}
              />
            </div>
          </Card>

          <Card className="p-4">
            <CardHeader
              title="Footer HTML"
              subtitle="Rendered at the bottom of every email — usually company address + unsubscribe."
            />
            <FormField label="HTML">
              <textarea
                className="input min-h-[140px] font-mono text-xs"
                value={draft.footerHtml ?? row.footerHtml ?? ""}
                onChange={(e) => setDraftField("footerHtml", e.target.value)}
                placeholder='e.g. <p>Acme Inc · 123 Main St · <a href="{{unsubscribe_url}}">Unsubscribe</a></p>'
              />
            </FormField>
          </Card>

          <Card className="p-4">
            <CardHeader title="Social links" subtitle="Shown in email footers + share sheets." />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FormField label="Twitter / X">
                <input
                  className="input"
                  value={socials.twitter ?? ""}
                  onChange={(e) => setSocialLink("twitter", e.target.value)}
                  placeholder="https://twitter.com/acme"
                />
              </FormField>
              <FormField label="LinkedIn">
                <input
                  className="input"
                  value={socials.linkedin ?? ""}
                  onChange={(e) => setSocialLink("linkedin", e.target.value)}
                  placeholder="https://linkedin.com/company/acme"
                />
              </FormField>
              <FormField label="Facebook">
                <input
                  className="input"
                  value={socials.facebook ?? ""}
                  onChange={(e) => setSocialLink("facebook", e.target.value)}
                  placeholder="https://facebook.com/acme"
                />
              </FormField>
              <FormField label="Instagram">
                <input
                  className="input"
                  value={socials.instagram ?? ""}
                  onChange={(e) => setSocialLink("instagram", e.target.value)}
                  placeholder="https://instagram.com/acme"
                />
              </FormField>
              <FormField label="YouTube">
                <input
                  className="input"
                  value={socials.youtube ?? ""}
                  onChange={(e) => setSocialLink("youtube", e.target.value)}
                  placeholder="https://youtube.com/@acme"
                />
              </FormField>
            </div>
          </Card>
        </div>

        {/* RIGHT: live preview (2 cols) */}
        <div className="lg:col-span-2">
          <Card className="p-3 sticky top-4">
            <CardHeader title="Live preview" subtitle="Save to refresh — the preview reflects the last saved state." />
            <div className="rounded-md border border-ink-muted/10 overflow-hidden bg-surface-sunken">
              <iframe
                key={previewSrc}
                src={previewSrc}
                title="Brand preview"
                className="w-full h-[560px] bg-white"
              />
            </div>
          </Card>
        </div>
      </div>

      {/* Merge tags reference */}
      <Card className="p-4 mt-6">
        <CardHeader
          title="Merge tags"
          subtitle="Drop these into any email template — they resolve against this brand kit at send time."
        />
        <MergeTagList />
      </Card>

      {/* Media picker drawer */}
      <Drawer
        open={pickerOpen !== null}
        onClose={() => setPickerOpen(null)}
        title={pickerOpen === "logo" ? "Choose logo" : "Choose favicon"}
        width="w-[640px]"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPickerOpen(null)}>
              Cancel
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <input
            className="input"
            placeholder="Search filenames…"
            value={pickerSearch}
            onChange={(e) => setPickerSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && pickerOpen) openPicker(pickerOpen);
            }}
          />
          {pickerLoading ? (
            <div className="text-ink-muted text-sm p-4">Loading…</div>
          ) : pickerRows.length === 0 ? (
            <div className="text-ink-muted text-sm p-4">
              No media yet — upload one via <a href="/admin/marketing/media-library" className="text-brand-600">Media library</a>.
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {pickerRows.map((m) => (
                <button
                  key={m.id}
                  className="rounded border border-ink-muted/10 p-2 bg-surface-sunken hover:border-brand-400 hover:shadow-brand-glow transition text-start"
                  onClick={() => {
                    if (pickerOpen === "logo") setDraftField("logoAssetId", m.id);
                    else if (pickerOpen === "favicon") setDraftField("faviconAssetId", m.id);
                    setPickerOpen(null);
                  }}
                >
                  {m.contentType.startsWith("image/") && m.presignedUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={m.presignedUrl}
                      alt={m.filename}
                      className="w-full h-16 object-contain bg-white rounded"
                    />
                  ) : (
                    <div className="w-full h-16 bg-white rounded grid place-items-center text-ink-muted text-xs">
                      {m.contentType}
                    </div>
                  )}
                  <div className="mt-1 text-[11px] text-ink-soft truncate" title={m.filename}>
                    {m.filename}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </Drawer>
    </AppShell>
  );
}

// ── Small helpers ─────────────────────────────────────────────────────
function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <FormField label={label}>
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="color"
          className="h-9 w-11 rounded border border-ink-muted/20 bg-surface-sunken cursor-pointer"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${label} colour picker`}
        />
        <input
          className="input flex-1 font-mono uppercase"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          maxLength={7}
        />
      </div>
    </FormField>
  );
}

function MediaPickerField({
  label,
  assetId,
  onPick,
  onClear,
}: {
  label: string;
  assetId: string | null;
  onPick: () => void;
  onClear: () => void;
}) {
  return (
    <FormField label={label}>
      <div className="flex items-center gap-2">
        <div className="input flex-1 tabular-nums font-mono text-xs text-ink-muted truncate">
          {assetId ?? "— none —"}
        </div>
        <Button variant="secondary" onClick={onPick}>
          Choose…
        </Button>
        {assetId && (
          <Button variant="ghost" onClick={onClear}>
            Clear
          </Button>
        )}
      </div>
    </FormField>
  );
}

function MergeTagList() {
  const tags = [
    { tag: "{{brand.logoUrl}}", desc: "Presigned URL for the logo MediaAsset (15-min TTL)." },
    { tag: "{{brand.faviconUrl}}", desc: "Presigned URL for the favicon MediaAsset." },
    { tag: "{{brand.primaryColor}}", desc: "Primary hex colour (e.g. buttons, links)." },
    { tag: "{{brand.secondaryColor}}", desc: "Secondary hex colour (e.g. borders, tints)." },
    { tag: "{{brand.accentColor}}", desc: "Accent hex colour (e.g. CTAs)." },
    { tag: "{{brand.neutralColor}}", desc: "Neutral text/foreground colour." },
    { tag: "{{brand.headingFont}}", desc: "CSS font-family string for headings." },
    { tag: "{{brand.bodyFont}}", desc: "CSS font-family string for body copy." },
    { tag: "{{brand.footerHtml}}", desc: "Configured HTML for the email footer." },
    { tag: "{{brand.socialLinks.twitter}}", desc: "Twitter/X URL (empty string if not set)." },
    { tag: "{{brand.socialLinks.linkedin}}", desc: "LinkedIn URL." },
    { tag: "{{brand.socialLinks.facebook}}", desc: "Facebook URL." },
    { tag: "{{brand.socialLinks.instagram}}", desc: "Instagram URL." },
    { tag: "{{brand.socialLinks.youtube}}", desc: "YouTube URL." },
  ];
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
      {tags.map((t) => (
        <div
          key={t.tag}
          className="flex items-start gap-3 rounded border border-ink-muted/10 bg-surface-sunken p-2"
        >
          <code className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-white border border-ink-muted/10 text-brand-700 whitespace-nowrap">
            {t.tag}
          </code>
          <div className="text-[12px] text-ink-muted">{t.desc}</div>
        </div>
      ))}
    </div>
  );
}
