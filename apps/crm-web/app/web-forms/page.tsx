"use client";

import { useEffect, useMemo, useState } from "react";
import { useListPageCommands, SavedViewsControls } from "@lumaara/web-ui";
import { api } from "../../lib/api";
import {
  Button,
  DataTable,
  Drawer,
  FilterBar,
  FormField,
  PageHeader,
  Segmented,
  StatusBadge,
  Toast,
  dateShort,
  type Column,
} from "../../components/ui";
import { Icon } from "../../components/app-shell";

// Zoho-Marketing-Plus style Web Forms — hosted, embeddable public forms that
// create a Lead (or Customer) plus optionally push the submitter onto a
// contact list and trigger an email sequence.

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
interface ContactList {
  id: string;
  name: string;
}
interface EmailSequence {
  id: string;
  name: string;
}

type StatusFilter = "all" | "active" | "draft";

interface FormState {
  name: string;
  publicSlug: string;
  title: string;
  description: string;
  submitLabel: string;
  successMessage: string;
  redirectUrl: string;
  targetType: "Lead" | "Customer";
  addToListId: string;
  triggerSequenceId: string;
  isActive: boolean;
}

const emptyForm: FormState = {
  name: "",
  publicSlug: "",
  title: "",
  description: "",
  submitLabel: "Submit",
  successMessage: "Thanks — we'll be in touch shortly.",
  redirectUrl: "",
  targetType: "Lead",
  addToListId: "",
  triggerSequenceId: "",
  isActive: true,
};

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function publicUrl(slug: string): string {
  return `${CRM_SERVICE_URL}/public/web-forms/${slug}/render`;
}

const DEFAULT_FIELDS: WebFormField[] = [
  { key: "name", label: "Name", type: "text", required: true },
  { key: "email", label: "Email", type: "email", required: true },
];

export default function WebFormsPage() {
  const [rows, setRows] = useState<WebForm[]>([]);
  const [lists, setLists] = useState<ContactList[]>([]);
  const [sequences, setSequences] = useState<EmailSequence[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [slugTouched, setSlugTouched] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    kind: "info" | "success" | "error";
    message: string;
  } | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  async function load() {
    setLoading(true);
    try {
      setRows(await api.get<WebForm[]>("/web-forms"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    api.get<ContactList[]>("/contact-lists").then(setLists).catch(() => {});
    api.get<EmailSequence[]>("/email-sequences").then(setSequences).catch(() => {});
  }, []);

  useListPageCommands({
    singular: "Web Form",
    plural: "Web Forms",
    refresh: load,
  });
  function edit(f: WebForm, ev: React.MouseEvent) {
    ev.stopPropagation();
    setForm({
      name: f.name,
      publicSlug: f.publicSlug,
      title: f.title,
      description: f.description ?? "",
      submitLabel: f.submitLabel ?? "Submit",
      successMessage: f.successMessage ?? "",
      redirectUrl: f.redirectUrl ?? "",
      targetType: f.targetType,
      addToListId: f.addToListId ?? "",
      triggerSequenceId: f.triggerSequenceId ?? "",
      isActive: f.isActive,
    });
    setEditingId(f.id);
    setSlugTouched(true);
    setShowForm(true);
  }

  function close() {
    setForm(emptyForm);
    setEditingId(null);
    setSlugTouched(false);
    setShowForm(false);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const body = {
        name: form.name,
        publicSlug: form.publicSlug || slugify(form.name),
        title: form.title || form.name,
        description: form.description || undefined,
        submitLabel: form.submitLabel || undefined,
        successMessage: form.successMessage || undefined,
        redirectUrl: form.redirectUrl || undefined,
        targetType: form.targetType,
        addToListId: form.addToListId || undefined,
        triggerSequenceId: form.triggerSequenceId || undefined,
        isActive: form.isActive,
        ...(editingId ? {} : { fieldsJson: DEFAULT_FIELDS }),
      };
      if (editingId) await api.put(`/web-forms/${editingId}`, body);
      else await api.post("/web-forms", body);
      close();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    }
  }

  async function remove(id: string, ev: React.MouseEvent) {
    ev.stopPropagation();
    if (!confirm("Delete this web form?")) return;
    try {
      await api.del(`/web-forms/${id}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  async function copySlug(slug: string, ev: React.MouseEvent) {
    ev.stopPropagation();
    try {
      await navigator.clipboard.writeText(publicUrl(slug));
      setToast({ kind: "success", message: "Copied public URL" });
    } catch {
      setToast({ kind: "error", message: "Copy failed" });
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter === "active" && !r.isActive) return false;
      if (statusFilter === "draft" && r.isActive) return false;
      if (
        q &&
        !`${r.name} ${r.title ?? ""} ${r.publicSlug}`.toLowerCase().includes(q)
      )
        return false;
      return true;
    });
  }, [rows, search, statusFilter]);

  const counts = useMemo(
    () => ({
      all: rows.length,
      active: rows.filter((r) => r.isActive).length,
      draft: rows.filter((r) => !r.isActive).length,
    }),
    [rows],
  );

  const columns: Column<WebForm>[] = [
    {
      header: "Name",
      cell: (f) => (
        <div className="flex flex-col">
          <a
            href={`/crm/web-forms/${f.id}`}
            className="font-medium text-ink hover:text-brand-700"
            onClick={(e) => e.stopPropagation()}
          >
            {f.name}
          </a>
          {f.title && (
            <span className="text-[11px] text-ink-muted truncate max-w-[280px]">
              {f.title}
            </span>
          )}
        </div>
      ),
    },
    {
      header: "Slug",
      cell: (f) => (
        <div className="flex items-center gap-1">
          <code className="font-mono text-xs text-ink-soft">{f.publicSlug}</code>
          <button
            onClick={(e) => copySlug(f.publicSlug, e)}
            className="p-1 rounded hover:bg-brand-50 text-ink-muted hover:text-brand-700"
            title="Copy public URL"
            aria-label="Copy public URL"
          >
            <svg width="12" height="12" viewBox="0 0 20 20" fill="none">
              <rect x="6" y="6" width="10" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M4 14V4a1 1 0 0 1 1-1h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      ),
    },
    {
      header: "Fields",
      align: "right",
      cell: (f) => (
        <span className="tabular-nums text-ink-soft">{f.fieldsJson?.length ?? 0}</span>
      ),
    },
    {
      header: "Submissions",
      align: "right",
      cell: (f) => (
        <span className="tabular-nums font-medium text-ink">
          {f.submissionCount ?? 0}
        </span>
      ),
    },
    {
      header: "Status",
      cell: (f) => <StatusBadge status={f.isActive ? "Active" : "Draft"} />,
    },
    {
      header: "Updated",
      cell: (f) => (
        <span className="text-xs text-ink-muted">{dateShort(f.updatedAt)}</span>
      ),
    },
    {
      header: "",
      align: "right",
      cell: (f) => (
        <div className="flex justify-end gap-2">
          <a
            href={publicUrl(f.publicSlug)}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="btn-ghost btn-sm"
          >
            Preview
          </a>
          <button onClick={(e) => edit(f, e)} className="btn-ghost btn-sm">
            Edit
          </button>
          <button
            onClick={(e) => remove(f.id, e)}
            className="btn-ghost btn-sm text-red-600 hover:text-red-700"
          >
            Delete
          </button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Web Forms"
        subtitle={
          rows.length === 0
            ? "Host embeddable lead-capture forms with sequence triggers"
            : `${counts.active} active · ${rows.length} total`
        }
        actions={
          <Button variant="brand" onClick={() => setShowForm(true)}>
            + New form
          </Button>
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

      <div className="space-y-4">
        <FilterBar
          search={{
            value: search,
            onChange: setSearch,
            placeholder: "Search form name, title or slug…",
          }}
          filters={
            <Segmented<StatusFilter>
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: "all", label: "All", count: counts.all },
                { value: "active", label: "Active", count: counts.active },
                { value: "draft", label: "Draft", count: counts.draft },
              ]}
        />
          }
          actions={<SavedViewsControls listKey="crm-web:web-forms" current={{ search, statusFilter }} onApply={(fv) => { setSearch(fv.search); setStatusFilter(fv.statusFilter); }} />}
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(f) => f.id}
          onRowClick={(f) => (window.location.href = `/crm/web-forms/${f.id}`)}
          loading={loading}
          empty={{
            icon: Icon.clipboard,
            title:
              search || statusFilter !== "all"
                ? "No matching forms"
                : "No web forms yet",
            description:
              search || statusFilter !== "all"
                ? "Try changing your search or filter."
                : "Create a form to capture leads from your marketing pages.",
            action: !search && statusFilter === "all" && (
              <Button variant="brand" onClick={() => setShowForm(true)}>
                + New form
              </Button>
            ),
          }}
        />
      </div>

      <Drawer
        open={showForm}
        onClose={close}
        width="w-[640px]"
        title={editingId ? "Edit web form" : "New web form"}
        footer={
          <>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button variant="brand" onClick={(e) => save(e as unknown as React.FormEvent)}>
              {editingId ? "Save changes" : "Create form"}
            </Button>
          </>
        }
      >
        <form onSubmit={save} className="space-y-6">
          <div className="space-y-4">
            <h4 className="text-xs uppercase tracking-wider text-ink-muted font-semibold">
              Basics
            </h4>
            <FormField label="Internal name" required>
              <input
                required
                className="input"
                placeholder="Website contact form"
                value={form.name}
                onChange={(e) => {
                  const name = e.target.value;
                  setForm((f) => ({
                    ...f,
                    name,
                    publicSlug: slugTouched ? f.publicSlug : slugify(name),
                  }));
                }}
                autoFocus
              />
            </FormField>
            <FormField
              label="Public slug"
              required
              hint={`Renders at ${publicUrl(form.publicSlug || "…")}`}
            >
              <input
                required
                className="input font-mono text-xs"
                placeholder="website-contact"
                value={form.publicSlug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setForm({ ...form, publicSlug: slugify(e.target.value) });
                }}
              />
            </FormField>
            <FormField label="Form title" required>
              <input
                required
                className="input"
                placeholder="Get in touch"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </FormField>
            <FormField label="Description">
              <textarea
                className="input"
                rows={2}
                placeholder="Optional sub-heading shown above the form"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </FormField>
          </div>

          <div className="space-y-4">
            <h4 className="text-xs uppercase tracking-wider text-ink-muted font-semibold">
              Behaviour
            </h4>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Submit button label">
                <input
                  className="input"
                  placeholder="Submit"
                  value={form.submitLabel}
                  onChange={(e) => setForm({ ...form, submitLabel: e.target.value })}
                />
              </FormField>
              <FormField label="Creates">
                <select
                  className="input"
                  value={form.targetType}
                  onChange={(e) =>
                    setForm({
                      ...form,
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
                value={form.successMessage}
                onChange={(e) => setForm({ ...form, successMessage: e.target.value })}
              />
            </FormField>
            <FormField label="Redirect URL (optional)" hint="If set, takes precedence over the success message.">
              <input
                className="input"
                placeholder="https://example.com/thanks"
                value={form.redirectUrl}
                onChange={(e) => setForm({ ...form, redirectUrl: e.target.value })}
              />
            </FormField>
          </div>

          <div className="space-y-4">
            <h4 className="text-xs uppercase tracking-wider text-ink-muted font-semibold">
              Post-submit automation
            </h4>
            <FormField label="Add to contact list">
              <select
                className="input"
                value={form.addToListId}
                onChange={(e) => setForm({ ...form, addToListId: e.target.value })}
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
                value={form.triggerSequenceId}
                onChange={(e) =>
                  setForm({ ...form, triggerSequenceId: e.target.value })
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
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                />
                <span className="text-sm text-ink-soft">
                  {form.isActive ? "Live — accepting submissions" : "Draft — public URL returns 404"}
                </span>
              </label>
            </FormField>
          </div>

          {!editingId && (
            <p className="text-[11px] text-ink-muted">
              Two starter fields (Name, Email) are added automatically. Edit them
              in the form builder after creating.
            </p>
          )}

          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </>
  );
}
