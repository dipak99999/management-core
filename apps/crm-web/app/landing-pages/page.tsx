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

// Zoho-Marketing-Plus style Landing Pages — hosted, publishable HTML pages
// (optionally linked to a Web Form for conversion attribution).

const CRM_SERVICE_URL =
  process.env.NEXT_PUBLIC_CRM_SERVICE_URL ?? "/api/crm";

interface LandingPage {
  id: string;
  name: string;
  publicSlug: string;
  title: string;
  description: string | null;
  bodyHtml: string;
  headHtml: string | null;
  isPublished: boolean;
  linkedWebFormId: string | null;
  viewCount: number;
  conversionCount: number;
  updatedAt: string;
}
interface WebFormRef {
  id: string;
  name: string;
}

type StatusFilter = "all" | "published" | "draft";

interface FormState {
  name: string;
  publicSlug: string;
  title: string;
  description: string;
  bodyHtml: string;
  headHtml: string;
  isPublished: boolean;
  linkedWebFormId: string;
}

const emptyForm: FormState = {
  name: "",
  publicSlug: "",
  title: "",
  description: "",
  bodyHtml:
    "<section style=\"max-width:640px;margin:60px auto;padding:0 24px;font-family:system-ui;\">\n  <h1>Your headline</h1>\n  <p>Sub-headline that sells the click.</p>\n</section>",
  headHtml: "",
  isPublished: false,
  linkedWebFormId: "",
};

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function publicUrl(slug: string): string {
  return `${CRM_SERVICE_URL}/public/pages/${slug}`;
}

export default function LandingPagesPage() {
  const [rows, setRows] = useState<LandingPage[]>([]);
  const [webForms, setWebForms] = useState<WebFormRef[]>([]);
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
      setRows(await api.get<LandingPage[]>("/landing-pages"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    api.get<WebFormRef[]>("/web-forms").then(setWebForms).catch(() => {});
  }, []);

  useListPageCommands({
    singular: "Landing Page",
    plural: "Landing Pages",
    refresh: load,
  });
  function edit(p: LandingPage, ev: React.MouseEvent) {
    ev.stopPropagation();
    setForm({
      name: p.name,
      publicSlug: p.publicSlug,
      title: p.title,
      description: p.description ?? "",
      bodyHtml: p.bodyHtml,
      headHtml: p.headHtml ?? "",
      isPublished: p.isPublished,
      linkedWebFormId: p.linkedWebFormId ?? "",
    });
    setEditingId(p.id);
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
        bodyHtml: form.bodyHtml,
        headHtml: form.headHtml || undefined,
        isPublished: form.isPublished,
        linkedWebFormId: form.linkedWebFormId || undefined,
      };
      if (editingId) await api.put(`/landing-pages/${editingId}`, body);
      else await api.post("/landing-pages", body);
      close();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    }
  }

  async function remove(id: string, ev: React.MouseEvent) {
    ev.stopPropagation();
    if (!confirm("Delete this landing page?")) return;
    try {
      await api.del(`/landing-pages/${id}`);
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
    return rows.filter((p) => {
      if (statusFilter === "published" && !p.isPublished) return false;
      if (statusFilter === "draft" && p.isPublished) return false;
      if (
        q &&
        !`${p.name} ${p.title ?? ""} ${p.publicSlug}`.toLowerCase().includes(q)
      )
        return false;
      return true;
    });
  }, [rows, search, statusFilter]);

  const counts = useMemo(
    () => ({
      all: rows.length,
      published: rows.filter((r) => r.isPublished).length,
      draft: rows.filter((r) => !r.isPublished).length,
    }),
    [rows],
  );

  const columns: Column<LandingPage>[] = [
    {
      header: "Name",
      cell: (p) => (
        <a
          href={`/crm/landing-pages/${p.id}`}
          className="font-medium text-ink hover:text-brand-700"
          onClick={(e) => e.stopPropagation()}
        >
          {p.name}
        </a>
      ),
    },
    {
      header: "Slug",
      cell: (p) => (
        <div className="flex items-center gap-1">
          <code className="font-mono text-xs text-ink-soft">{p.publicSlug}</code>
          <button
            onClick={(e) => copySlug(p.publicSlug, e)}
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
      header: "Title",
      cell: (p) => (
        <span className="text-sm text-ink-soft truncate max-w-[240px] block">
          {p.title || "—"}
        </span>
      ),
    },
    {
      header: "Views",
      align: "right",
      cell: (p) => (
        <span className="tabular-nums text-ink-soft">
          {(p.viewCount ?? 0).toLocaleString()}
        </span>
      ),
    },
    {
      header: "Conversions",
      align: "right",
      cell: (p) => (
        <span className="tabular-nums font-medium text-ink">
          {(p.conversionCount ?? 0).toLocaleString()}
        </span>
      ),
    },
    {
      header: "Status",
      cell: (p) => (
        <StatusBadge status={p.isPublished ? "Active" : "Draft"} />
      ),
    },
    {
      header: "Updated",
      cell: (p) => (
        <span className="text-xs text-ink-muted">{dateShort(p.updatedAt)}</span>
      ),
    },
    {
      header: "",
      align: "right",
      cell: (p) => (
        <div className="flex justify-end gap-2">
          <a
            href={publicUrl(p.publicSlug)}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="btn-ghost btn-sm"
          >
            Preview
          </a>
          <button onClick={(e) => edit(p, e)} className="btn-ghost btn-sm">
            Edit
          </button>
          <button
            onClick={(e) => remove(p.id, e)}
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
        title="Landing Pages"
        subtitle={
          rows.length === 0
            ? "Publish standalone HTML landing pages linked to your web forms"
            : `${counts.published} published · ${rows.length} total`
        }
        actions={
          <Button variant="brand" onClick={() => setShowForm(true)}>
            + New page
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
            placeholder: "Search page name, title or slug…",
          }}
          filters={
            <Segmented<StatusFilter>
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: "all", label: "All", count: counts.all },
                { value: "published", label: "Published", count: counts.published },
                { value: "draft", label: "Draft", count: counts.draft },
              ]}
        />
          }
          actions={<SavedViewsControls listKey="crm-web:landing-pages" current={{ search, statusFilter }} onApply={(fv) => { setSearch(fv.search); setStatusFilter(fv.statusFilter); }} />}
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(p) => p.id}
          onRowClick={(p) => (window.location.href = `/crm/landing-pages/${p.id}`)}
          loading={loading}
          empty={{
            icon: Icon.book,
            title:
              search || statusFilter !== "all"
                ? "No matching pages"
                : "No landing pages yet",
            description:
              search || statusFilter !== "all"
                ? "Try changing your search or filter."
                : "Ship a landing page in minutes — paste HTML, link a form, publish.",
            action: !search && statusFilter === "all" && (
              <Button variant="brand" onClick={() => setShowForm(true)}>
                + New page
              </Button>
            ),
          }}
        />
      </div>

      <Drawer
        open={showForm}
        onClose={close}
        width="w-[820px]"
        title={editingId ? "Edit landing page" : "New landing page"}
        footer={
          <>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button
              variant="brand"
              onClick={(e) => save(e as unknown as React.FormEvent)}
            >
              {editingId ? "Save changes" : "Create page"}
            </Button>
          </>
        }
      >
        <form onSubmit={save} className="space-y-6">
          <div className="space-y-4">
            <h4 className="text-xs uppercase tracking-wider text-ink-muted font-semibold">
              Basics
            </h4>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Internal name" required>
                <input
                  required
                  className="input"
                  placeholder="Spring campaign LP"
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
                  placeholder="spring-campaign"
                  value={form.publicSlug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    setForm({ ...form, publicSlug: slugify(e.target.value) });
                  }}
                />
              </FormField>
            </div>
            <FormField label="Page title (HTML <title>)" required>
              <input
                required
                className="input"
                placeholder="Get 30% off — Spring launch"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </FormField>
            <FormField label="Description (meta)">
              <textarea
                className="input"
                rows={2}
                placeholder="Optional — used in the meta description tag"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Linked web form">
                <select
                  className="input"
                  value={form.linkedWebFormId}
                  onChange={(e) =>
                    setForm({ ...form, linkedWebFormId: e.target.value })
                  }
                >
                  <option value="">— none —</option>
                  {webForms.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Published">
                <label className="flex items-center gap-2 cursor-pointer h-9">
                  <input
                    type="checkbox"
                    checked={form.isPublished}
                    onChange={(e) =>
                      setForm({ ...form, isPublished: e.target.checked })
                    }
                  />
                  <span className="text-sm text-ink-soft">
                    {form.isPublished ? "Live — publicly visible" : "Draft"}
                  </span>
                </label>
              </FormField>
            </div>
          </div>

          <div className="space-y-4">
            <h4 className="text-xs uppercase tracking-wider text-ink-muted font-semibold">
              Page HTML
            </h4>
            <FormField
              label="Custom <head> markup"
              hint="Inject stylesheets, fonts, analytics snippets, etc."
            >
              <textarea
                className="input font-mono text-xs"
                rows={4}
                placeholder="<link rel='stylesheet' href='…' />"
                value={form.headHtml}
                onChange={(e) => setForm({ ...form, headHtml: e.target.value })}
              />
            </FormField>
            <FormField label="Body HTML" required>
              <textarea
                required
                className="input font-mono text-xs min-h-96"
                rows={20}
                value={form.bodyHtml}
                onChange={(e) => setForm({ ...form, bodyHtml: e.target.value })}
              />
            </FormField>
          </div>

          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </>
  );
}
