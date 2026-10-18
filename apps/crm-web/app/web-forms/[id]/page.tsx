"use client";

import { useEffect, useMemo, useState } from "react";
import { DocActivityPanel } from "@lumaara/web-ui";
import { useParams } from "next/navigation";
import { api } from "../../../lib/api";
import {
  Button,
  Card,
  CardHeader,
  Drawer,
  Field,
  FormField,
  PageHeader,
  SectionHeader,
  StatusBadge,
  Toast,
  dateShort,
} from "../../../components/ui";

// Detail + builder for a single Web Form. Left 2/3 is the field builder,
// right 1/3 is the settings summary + submissions log.

const CRM_SERVICE_URL =
  process.env.NEXT_PUBLIC_CRM_SERVICE_URL ?? "/api/crm";

type FieldType =
  | "text"
  | "textarea"
  | "email"
  | "phone"
  | "select"
  | "checkbox"
  | "number";

const FIELD_TYPES: FieldType[] = [
  "text",
  "textarea",
  "email",
  "phone",
  "select",
  "checkbox",
  "number",
];

interface WebFormField {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  placeholder?: string;
  options?: string[];
}

interface WebForm {
  id: string;
  name: string;
  publicSlug: string;
  title: string;
  description: string | null;
  submitLabel: string | null;
  successMessage: string | null;
  redirectUrl: string | null;
  targetType: "Lead" | "Customer";
  addToListId: string | null;
  triggerSequenceId: string | null;
  fieldsJson: WebFormField[];
  submissionCount: number;
  isActive: boolean;
  updatedAt: string;
}
interface Submission {
  id: string;
  fieldsJson: Record<string, unknown>;
  createdLeadId: string | null;
  ipAddress: string | null;
  referrer: string | null;
  createdAt: string;
}
interface NamedRef {
  id: string;
  name: string;
}

const emptyField: WebFormField = {
  key: "",
  label: "",
  type: "text",
  required: false,
  placeholder: "",
  options: [],
};

function publicUrl(slug: string): string {
  return `${CRM_SERVICE_URL}/public/web-forms/${slug}/render`;
}

function embedSnippet(slug: string): string {
  return `<iframe src="${publicUrl(slug)}" width="100%" height="600" frameborder="0" style="border:0"></iframe>`;
}

function TypeBadge({ type }: { type: FieldType }) {
  const cls =
    type === "email" || type === "phone"
      ? "badge-blue"
      : type === "select" || type === "checkbox"
        ? "badge-violet"
        : type === "number"
          ? "badge-amber"
          : "badge-gray";
  return <span className={cls}>{type}</span>;
}

// iOS-style toggle
function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  return (
    <label className="inline-flex items-center gap-2 cursor-pointer">
      <span
        className={`relative inline-block w-9 h-5 rounded-full transition ${
          checked ? "bg-brand-500" : "bg-ink-muted/30"
        }`}
        onClick={() => onChange(!checked)}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${
            checked ? "left-[18px]" : "start-0.5"
          }`}
        />
      </span>
      {label && <span className="text-sm text-ink-soft">{label}</span>}
    </label>
  );
}

export default function WebFormDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [wf, setWf] = useState<WebForm | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [lists, setLists] = useState<NamedRef[]>([]);
  const [sequences, setSequences] = useState<NamedRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    kind: "info" | "success" | "error";
    message: string;
  } | null>(null);

  // Field drawer
  const [showField, setShowField] = useState(false);
  const [fieldIdx, setFieldIdx] = useState<number | null>(null);
  const [fieldForm, setFieldForm] = useState<WebFormField>(emptyField);
  const [optionsRaw, setOptionsRaw] = useState("");

  // Settings drawer
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState({
    name: "",
    publicSlug: "",
    title: "",
    description: "",
    submitLabel: "",
    successMessage: "",
    redirectUrl: "",
    targetType: "Lead" as "Lead" | "Customer",
    addToListId: "",
    triggerSequenceId: "",
    isActive: true,
  });

  // Submissions expanded state
  const [showSubs, setShowSubs] = useState(false);

  async function loadForm() {
    try {
      const f = await api.get<WebForm>(`/web-forms/${id}`);
      setWf(f);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load form");
    }
  }
  async function loadSubs() {
    try {
      setSubmissions(
        await api.get<Submission[]>(`/web-forms/${id}/submissions`),
      );
    } catch {
      /* silent */
    }
  }
  async function loadAll() {
    setLoading(true);
    await Promise.all([loadForm(), loadSubs()]);
    setLoading(false);
  }
  useEffect(() => {
    loadAll();
    api.get<NamedRef[]>("/contact-lists").then(setLists).catch(() => {});
    api.get<NamedRef[]>("/email-sequences").then(setSequences).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Persist the current form state (fields + settings) via PUT.
  async function persist(next: WebForm) {
    setError(null);
    try {
      const body = {
        name: next.name,
        publicSlug: next.publicSlug,
        title: next.title,
        description: next.description ?? undefined,
        submitLabel: next.submitLabel ?? undefined,
        successMessage: next.successMessage ?? undefined,
        redirectUrl: next.redirectUrl ?? undefined,
        targetType: next.targetType,
        addToListId: next.addToListId ?? undefined,
        triggerSequenceId: next.triggerSequenceId ?? undefined,
        fieldsJson: next.fieldsJson,
        isActive: next.isActive,
      };
      await api.put(`/web-forms/${id}`, body);
      await loadForm();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    }
  }

  function openAddField() {
    setFieldIdx(null);
    setFieldForm({ ...emptyField });
    setOptionsRaw("");
    setShowField(true);
  }
  function openEditField(i: number) {
    if (!wf) return;
    const f = wf.fieldsJson[i];
    setFieldIdx(i);
    setFieldForm({ ...f });
    setOptionsRaw((f.options ?? []).join(", "));
    setShowField(true);
  }
  async function saveField(e: React.FormEvent) {
    e.preventDefault();
    if (!wf) return;
    const parsedOptions =
      fieldForm.type === "select"
        ? optionsRaw
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined;
    const next: WebFormField = {
      key: fieldForm.key.trim(),
      label: fieldForm.label.trim(),
      type: fieldForm.type,
      required: fieldForm.required,
      placeholder: fieldForm.placeholder || undefined,
      ...(parsedOptions ? { options: parsedOptions } : {}),
    };
    if (!next.key || !next.label) {
      setError("Field key and label are required");
      return;
    }
    const fields = [...wf.fieldsJson];
    if (fieldIdx == null) fields.push(next);
    else fields[fieldIdx] = next;
    setShowField(false);
    await persist({ ...wf, fieldsJson: fields });
  }
  async function deleteField(i: number) {
    if (!wf) return;
    if (!confirm(`Delete field "${wf.fieldsJson[i].label}"?`)) return;
    const fields = wf.fieldsJson.filter((_, idx) => idx !== i);
    await persist({ ...wf, fieldsJson: fields });
  }
  async function moveField(i: number, dir: -1 | 1) {
    if (!wf) return;
    const j = i + dir;
    if (j < 0 || j >= wf.fieldsJson.length) return;
    const fields = [...wf.fieldsJson];
    [fields[i], fields[j]] = [fields[j], fields[i]];
    await persist({ ...wf, fieldsJson: fields });
  }

  function openSettings() {
    if (!wf) return;
    setSettings({
      name: wf.name,
      publicSlug: wf.publicSlug,
      title: wf.title,
      description: wf.description ?? "",
      submitLabel: wf.submitLabel ?? "Submit",
      successMessage: wf.successMessage ?? "",
      redirectUrl: wf.redirectUrl ?? "",
      targetType: wf.targetType,
      addToListId: wf.addToListId ?? "",
      triggerSequenceId: wf.triggerSequenceId ?? "",
      isActive: wf.isActive,
    });
    setShowSettings(true);
  }
  async function saveSettings(e: React.FormEvent) {
    e.preventDefault();
    if (!wf) return;
    setShowSettings(false);
    await persist({
      ...wf,
      name: settings.name,
      publicSlug: settings.publicSlug,
      title: settings.title,
      description: settings.description || null,
      submitLabel: settings.submitLabel || null,
      successMessage: settings.successMessage || null,
      redirectUrl: settings.redirectUrl || null,
      targetType: settings.targetType,
      addToListId: settings.addToListId || null,
      triggerSequenceId: settings.triggerSequenceId || null,
      isActive: settings.isActive,
    });
  }

  async function toggleActive() {
    if (!wf) return;
    await persist({ ...wf, isActive: !wf.isActive });
  }

  async function removeForm() {
    if (!confirm("Delete this web form? Existing submissions will remain.")) return;
    try {
      await api.del(`/web-forms/${id}`);
      window.location.href = "/crm/web-forms";
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    }
  }

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setToast({ kind: "success", message: `Copied ${label}` });
    } catch {
      setToast({ kind: "error", message: "Copy failed" });
    }
  }

  const listName = useMemo(
    () => lists.find((l) => l.id === wf?.addToListId)?.name ?? null,
    [lists, wf],
  );
  const seqName = useMemo(
    () => sequences.find((s) => s.id === wf?.triggerSequenceId)?.name ?? null,
    [sequences, wf],
  );

  if (!wf && !loading) {
    return (
      <>
        {error && (
          <div className="mb-4">
            <Toast kind="error" message={error} onDismiss={() => setError(null)} />
          </div>
        )}
        <a href="/crm/web-forms" className="text-sm text-brand-600 hover:underline">
          ← Back to forms
        </a>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={wf?.name ?? "Loading…"}
        subtitle={
          wf ? (
            <span>
              <code className="font-mono text-xs">{wf.publicSlug}</code> ·{" "}
              {wf.fieldsJson.length} field{wf.fieldsJson.length === 1 ? "" : "s"}{" "}
              · {wf.submissionCount} submission
              {wf.submissionCount === 1 ? "" : "s"}
            </span>
          ) : undefined
        }
        breadcrumb={[
          { label: "Web Forms", href: "/crm/web-forms" },
          { label: wf?.name ?? "…" },
        ]}
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => history.back()}
              type="button"
            >
              ← Back
            </Button>
            {wf && (
              <>
                <span className="me-1">
                  <StatusBadge status={wf.isActive ? "Active" : "Draft"} />
                </span>
                <a
                  href={publicUrl(wf.publicSlug)}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-secondary btn-sm"
                >
                  Preview
                </a>
                <Button variant="secondary" size="sm" onClick={openSettings}>
                  Edit settings
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={removeForm}
                >
                  Delete
                </Button>
              </>
            )}
          </>
        }
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

      {wf && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* ── Left: field builder (2/3) ─────────────────────────── */}
          <div className="lg:col-span-2 space-y-4">
            <Card className="p-4">
              <CardHeader
                title="Form fields"
                subtitle={`${wf.fieldsJson.length} field${wf.fieldsJson.length === 1 ? "" : "s"} · rendered top-to-bottom`}
                actions={
                  <Button variant="brand" size="sm" onClick={openAddField}>
                    + Add field
                  </Button>
                }
              />
              {wf.fieldsJson.length === 0 ? (
                <div className="text-sm text-ink-muted p-6 text-center">
                  No fields yet — add one to start collecting submissions.
                </div>
              ) : (
                <div className="divide-y divide-ink-muted/10">
                  {wf.fieldsJson.map((f, i) => (
                    <div
                      key={`${f.key}-${i}`}
                      className="py-3 flex items-center gap-3"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-ink">{f.label}</span>
                          <TypeBadge type={f.type} />
                          {f.required && (
                            <span className="badge-amber">required</span>
                          )}
                        </div>
                        <div className="mt-1 flex items-center gap-3 text-xs text-ink-muted">
                          <code className="font-mono">{f.key}</code>
                          {f.placeholder && (
                            <span className="truncate">
                              placeholder: {f.placeholder}
                            </span>
                          )}
                          {f.type === "select" && f.options && f.options.length > 0 && (
                            <span className="truncate">
                              options: {f.options.join(", ")}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => moveField(i, -1)}
                          disabled={i === 0}
                          className="btn-ghost btn-sm disabled:opacity-30"
                          title="Move up"
                          aria-label="Move up"
                        >
                          ↑
                        </button>
                        <button
                          onClick={() => moveField(i, 1)}
                          disabled={i === wf.fieldsJson.length - 1}
                          className="btn-ghost btn-sm disabled:opacity-30"
                          title="Move down"
                          aria-label="Move down"
                        >
                          ↓
                        </button>
                        <button
                          onClick={() => openEditField(i)}
                          className="btn-ghost btn-sm"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => deleteField(i)}
                          className="btn-ghost btn-sm text-red-600 hover:text-red-700"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          {/* ── Right: settings + submissions (1/3) ────────────────── */}
          <div className="space-y-4">
            <Card className="p-4">
              <CardHeader
                title="Settings"
                actions={
                  <Toggle
                    checked={wf.isActive}
                    onChange={() => toggleActive()}
                  />
                }
              />
              <div className="space-y-3">
                <Field label="Title" value={wf.title} />
                <Field label="Description" value={wf.description} />
                <Field label="Submit label" value={wf.submitLabel} />
                <Field label="Success message" value={wf.successMessage} />
                <Field
                  label="Redirect URL"
                  value={
                    wf.redirectUrl ? (
                      <a
                        href={wf.redirectUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-brand-600 hover:underline break-all"
                      >
                        {wf.redirectUrl}
                      </a>
                    ) : null
                  }
                />
                <Field
                  label="Creates"
                  value={<span className="badge-blue">{wf.targetType}</span>}
                />
                <Field label="Add to list" value={listName ?? "—"} />
                <Field label="Trigger sequence" value={seqName ?? "—"} />
                <Field
                  label="Updated"
                  value={dateShort(wf.updatedAt)}
                />
              </div>
              <div className="mt-4 pt-4 border-t border-ink-muted/10 space-y-2">
                <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
                  Public URL
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 min-w-0 truncate font-mono text-xs bg-surface-sunken border border-ink-muted/10 rounded px-2 py-1">
                    {publicUrl(wf.publicSlug)}
                  </code>
                  <button
                    onClick={() => copy(publicUrl(wf.publicSlug), "URL")}
                    className="btn-secondary btn-sm shrink-0"
                  >
                    Copy
                  </button>
                </div>
                <button
                  onClick={() => copy(embedSnippet(wf.publicSlug), "embed snippet")}
                  className="btn-ghost btn-sm w-full"
                >
                  Copy embed snippet
                </button>
              </div>
            </Card>

            <Card className="p-4">
              <CardHeader
                title="Recent submissions"
                subtitle={`${wf.submissionCount} total`}
                actions={
                  submissions.length > 0 ? (
                    <button
                      onClick={() => setShowSubs((v) => !v)}
                      className="btn-ghost btn-sm"
                    >
                      {showSubs ? "Hide" : "Show"}
                    </button>
                  ) : undefined
                }
              />
              {submissions.length === 0 ? (
                <div className="text-sm text-ink-muted text-center py-4">
                  No submissions yet.
                </div>
              ) : !showSubs ? (
                <div className="text-xs text-ink-muted">
                  Last:{" "}
                  <span className="text-ink-soft">
                    {dateShort(submissions[0].createdAt)}
                  </span>
                </div>
              ) : (
                <div className="space-y-3 max-h-[500px] overflow-y-auto">
                  {submissions.slice(0, 20).map((s) => (
                    <div
                      key={s.id}
                      className="rounded-lg border border-ink-muted/10 bg-surface-sunken p-3"
                    >
                      <div className="flex items-center justify-between text-[11px] text-ink-muted mb-2">
                        <span>{dateShort(s.createdAt)}</span>
                        {s.createdLeadId && (
                          <a
                            href={`/crm/leads/${s.createdLeadId}`}
                            className="text-brand-600 hover:underline"
                          >
                            View lead →
                          </a>
                        )}
                      </div>
                      <pre className="font-mono text-[11px] text-ink whitespace-pre-wrap break-words">
                        {JSON.stringify(s.fieldsJson, null, 2)}
                      </pre>
                      {(s.ipAddress || s.referrer) && (
                        <div className="mt-2 pt-2 border-t border-ink-muted/10 text-[10px] text-ink-muted">
                          {s.ipAddress && <div>IP: {s.ipAddress}</div>}
                          {s.referrer && (
                            <div className="truncate">Referrer: {s.referrer}</div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>
      )}

      {/* ── Field drawer ─────────────────────────────────────────── */}
      <Drawer
        open={showField}
        onClose={() => setShowField(false)}
        title={fieldIdx == null ? "Add field" : "Edit field"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowField(false)}>
              Cancel
            </Button>
            <Button
              variant="brand"
              onClick={(e) => saveField(e as unknown as React.FormEvent)}
            >
              {fieldIdx == null ? "Add field" : "Save changes"}
            </Button>
          </>
        }
      >
        <form onSubmit={saveField} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Key" required hint="Machine-readable, e.g. company_name">
              <input
                required
                className="input font-mono text-xs"
                value={fieldForm.key}
                onChange={(e) =>
                  setFieldForm({
                    ...fieldForm,
                    key: e.target.value.replace(/\s+/g, "_").toLowerCase(),
                  })
                }
                autoFocus
              />
            </FormField>
            <FormField label="Label" required>
              <input
                required
                className="input"
                value={fieldForm.label}
                onChange={(e) => setFieldForm({ ...fieldForm, label: e.target.value })}
              />
            </FormField>
          </div>
          <FormField label="Type" required>
            <select
              className="input"
              value={fieldForm.type}
              onChange={(e) =>
                setFieldForm({ ...fieldForm, type: e.target.value as FieldType })
              }
            >
              {FIELD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Placeholder">
            <input
              className="input"
              value={fieldForm.placeholder ?? ""}
              onChange={(e) =>
                setFieldForm({ ...fieldForm, placeholder: e.target.value })
              }
            />
          </FormField>
          {fieldForm.type === "select" && (
            <FormField
              label="Options"
              hint="Comma-separated, e.g. Small, Medium, Large"
            >
              <input
                className="input"
                value={optionsRaw}
                onChange={(e) => setOptionsRaw(e.target.value)}
              />
            </FormField>
          )}
          <FormField label="Required">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={!!fieldForm.required}
                onChange={(e) =>
                  setFieldForm({ ...fieldForm, required: e.target.checked })
                }
              />
              <span className="text-sm text-ink-soft">
                Must be filled in before the form can be submitted
              </span>
            </label>
          </FormField>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>

      {/* ── Settings drawer ──────────────────────────────────────── */}
      <Drawer
        open={showSettings}
        onClose={() => setShowSettings(false)}
        width="w-[640px]"
        title="Edit settings"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowSettings(false)}>
              Cancel
            </Button>
            <Button
              variant="brand"
              onClick={(e) => saveSettings(e as unknown as React.FormEvent)}
            >
              Save changes
            </Button>
          </>
        }
      >
        <form onSubmit={saveSettings} className="space-y-6">
          <div className="space-y-4">
            <SectionHeader title="Basics" />
            <FormField label="Internal name" required>
              <input
                required
                className="input"
                value={settings.name}
                onChange={(e) => setSettings({ ...settings, name: e.target.value })}
              />
            </FormField>
            <FormField label="Public slug" required>
              <input
                required
                className="input font-mono text-xs"
                value={settings.publicSlug}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    publicSlug: e.target.value
                      .toLowerCase()
                      .replace(/[^a-z0-9]+/g, "-"),
                  })
                }
              />
            </FormField>
            <FormField label="Title" required>
              <input
                required
                className="input"
                value={settings.title}
                onChange={(e) => setSettings({ ...settings, title: e.target.value })}
              />
            </FormField>
            <FormField label="Description">
              <textarea
                className="input"
                rows={2}
                value={settings.description}
                onChange={(e) =>
                  setSettings({ ...settings, description: e.target.value })
                }
              />
            </FormField>
          </div>

          <div className="space-y-4">
            <SectionHeader title="Behaviour" />
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Submit label">
                <input
                  className="input"
                  value={settings.submitLabel}
                  onChange={(e) =>
                    setSettings({ ...settings, submitLabel: e.target.value })
                  }
                />
              </FormField>
              <FormField label="Creates">
                <select
                  className="input"
                  value={settings.targetType}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      targetType: e.target.value as "Lead" | "Customer",
                    })
                  }
                >
                  <option value="Lead">Lead</option>
                  <option value="Customer">Customer</option>
                </select>
              </FormField>
            </div>
            <FormField label="Success message">
              <textarea
                className="input"
                rows={2}
                value={settings.successMessage}
                onChange={(e) =>
                  setSettings({ ...settings, successMessage: e.target.value })
                }
              />
            </FormField>
            <FormField label="Redirect URL">
              <input
                className="input"
                value={settings.redirectUrl}
                onChange={(e) =>
                  setSettings({ ...settings, redirectUrl: e.target.value })
                }
              />
            </FormField>
          </div>

          <div className="space-y-4">
            <SectionHeader title="Automation" />
            <FormField label="Add to contact list">
              <select
                className="input"
                value={settings.addToListId}
                onChange={(e) =>
                  setSettings({ ...settings, addToListId: e.target.value })
                }
              >
                <option value="">— none —</option>
                {lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Trigger email sequence">
              <select
                className="input"
                value={settings.triggerSequenceId}
                onChange={(e) =>
                  setSettings({ ...settings, triggerSequenceId: e.target.value })
                }
              >
                <option value="">— none —</option>
                {sequences.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Active">
              <Toggle
                checked={settings.isActive}
                onChange={(v) => setSettings({ ...settings, isActive: v })}
                label={
                  settings.isActive
                    ? "Live — accepting submissions"
                    : "Draft — public URL returns 404"
                }
              />
            </FormField>
          </div>

          <button type="submit" className="hidden" />
        </form>
      </Drawer>

      <div className="rounded-xl border border-ink/10 bg-canvas p-4 mt-6">
        <h3 className="text-sm font-semibold text-ink mb-3">Activity</h3>
        <DocActivityPanel doctype="WebForm" docId={params.id} />
      </div>
    </>
  );
}
