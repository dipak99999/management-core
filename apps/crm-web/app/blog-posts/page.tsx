"use client";

// Blog Posts admin — chronological articles published at /portal/blog and
// /portal/blog/:slug on portal-web. Same shape as Web Pages plus author,
// excerpt, category, and featured image.

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

const PORTAL_URL =
  process.env.NEXT_PUBLIC_PORTAL_URL ?? "http://localhost:3007/portal";

interface BlogPost {
  id: string;
  name: string;
  publicSlug: string;
  title: string;
  excerpt: string | null;
  bodyHtml: string;
  authorName: string | null;
  category: string | null;
  featuredImage: string | null;
  isPublished: boolean;
  publishedAt: string | null;
  updatedAt: string;
}

type StatusFilter = "all" | "published" | "draft";

interface FormState {
  name: string;
  publicSlug: string;
  title: string;
  excerpt: string;
  bodyHtml: string;
  authorName: string;
  category: string;
  featuredImage: string;
  isPublished: boolean;
}

const emptyForm: FormState = {
  name: "",
  publicSlug: "",
  title: "",
  excerpt: "",
  bodyHtml:
    '<article style="max-width:720px;margin:0 auto;padding:0 24px;font-family:system-ui;color:#111827;line-height:1.7;">\n  <p>Your opening paragraph. Grab the reader in the first two lines.</p>\n  <h2>A subheading</h2>\n  <p>The next section.</p>\n</article>',
  authorName: "",
  category: "",
  featuredImage: "",
  isPublished: false,
};

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function publicUrl(slug: string): string {
  return `${PORTAL_URL}/blog/${slug}`;
}

export default function BlogPostsPage() {
  const [rows, setRows] = useState<BlogPost[]>([]);
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
      setRows(await api.get<BlogPost[]>("/blog-posts"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  useListPageCommands({
    singular: "Blog Post",
    plural: "Blog Posts",
    refresh: load,
  });
  function edit(p: BlogPost, ev: React.MouseEvent) {
    ev.stopPropagation();
    setForm({
      name: p.name,
      publicSlug: p.publicSlug,
      title: p.title,
      excerpt: p.excerpt ?? "",
      bodyHtml: p.bodyHtml,
      authorName: p.authorName ?? "",
      category: p.category ?? "",
      featuredImage: p.featuredImage ?? "",
      isPublished: p.isPublished,
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
        excerpt: form.excerpt || undefined,
        bodyHtml: form.bodyHtml,
        authorName: form.authorName || undefined,
        category: form.category || undefined,
        featuredImage: form.featuredImage || undefined,
        isPublished: form.isPublished,
      };
      if (editingId) await api.put(`/blog-posts/${editingId}`, body);
      else await api.post("/blog-posts", body);
      close();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    }
  }

  async function remove(id: string, ev: React.MouseEvent) {
    ev.stopPropagation();
    if (!confirm("Delete this post? This can't be undone.")) return;
    try {
      await api.del(`/blog-posts/${id}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  async function copyUrl(slug: string, ev: React.MouseEvent) {
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
        !`${p.name} ${p.title ?? ""} ${p.category ?? ""} ${p.authorName ?? ""}`
          .toLowerCase()
          .includes(q)
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

  const columns: Column<BlogPost>[] = [
    {
      header: "Title",
      cell: (p) => (
        <div onClick={(e) => e.stopPropagation()}>
          <button
            onClick={(e) => edit(p, e)}
            className="font-medium text-ink hover:text-brand-700 text-start"
          >
            {p.title}
          </button>
          <div className="text-xs text-ink-muted truncate max-w-[320px]">
            {p.excerpt ?? "—"}
          </div>
        </div>
      ),
    },
    {
      header: "Slug",
      cell: (p) => (
        <div className="flex items-center gap-1">
          <code className="font-mono text-xs text-ink-soft">/blog/{p.publicSlug}</code>
          <button
            onClick={(e) => copyUrl(p.publicSlug, e)}
            className="p-1 rounded hover:bg-brand-50 text-ink-muted hover:text-brand-700"
            title="Copy public URL"
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
      header: "Author",
      cell: (p) => <span className="text-sm text-ink-soft">{p.authorName ?? "—"}</span>,
    },
    {
      header: "Category",
      cell: (p) =>
        p.category ? <span className="badge-gray">{p.category}</span> : <span className="text-ink-muted">—</span>,
    },
    {
      header: "Status",
      cell: (p) => <StatusBadge status={p.isPublished ? "Active" : "Draft"} />,
    },
    {
      header: "Published",
      cell: (p) => (
        <span className="text-xs text-ink-muted">
          {p.publishedAt ? dateShort(p.publishedAt) : "—"}
        </span>
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
        title="Blog Posts"
        subtitle={
          rows.length === 0
            ? "Chronological articles published at /portal/blog"
            : `${counts.published} published · ${rows.length} total`
        }
        actions={
          <Button variant="brand" onClick={() => setShowForm(true)}>
            + New post
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
            placeholder: "Search title, author, category…",
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
          actions={<SavedViewsControls listKey="crm-web:blog-posts" current={{ search, statusFilter }} onApply={(fv) => { setSearch(fv.search); setStatusFilter(fv.statusFilter); }} />}
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(p) => p.id}
          onRowClick={(p) =>
            window.open(publicUrl(p.publicSlug), "_blank", "noreferrer")
          }
          loading={loading}
          empty={{
            icon: Icon.book,
            title:
              search || statusFilter !== "all"
                ? "No matching posts"
                : "No blog posts yet",
            description:
              search || statusFilter !== "all"
                ? "Try changing your search or filter."
                : "Ship your first article — the /blog index picks up published posts automatically.",
            action: !search && statusFilter === "all" && (
              <Button variant="brand" onClick={() => setShowForm(true)}>
                + New post
              </Button>
            ),
          }}
        />
      </div>

      <Drawer
        open={showForm}
        onClose={close}
        width="w-[820px]"
        title={editingId ? "Edit post" : "New post"}
        footer={
          <>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button
              variant="brand"
              onClick={(e) => save(e as unknown as React.FormEvent)}
            >
              {editingId ? "Save changes" : "Create post"}
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
                  placeholder="Launching our new integrations"
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
                  placeholder="launching-new-integrations"
                  value={form.publicSlug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    setForm({ ...form, publicSlug: slugify(e.target.value) });
                  }}
                />
              </FormField>
            </div>
            <FormField label="Post title" required>
              <input
                required
                className="input"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </FormField>
            <FormField label="Excerpt (shown on the /blog index card)">
              <textarea
                className="input"
                rows={2}
                placeholder="Optional — 1-2 sentences summarising the post"
                value={form.excerpt}
                onChange={(e) => setForm({ ...form, excerpt: e.target.value })}
              />
            </FormField>
            <div className="grid grid-cols-3 gap-3">
              <FormField label="Author">
                <input
                  className="input"
                  placeholder="Jane Doe"
                  value={form.authorName}
                  onChange={(e) => setForm({ ...form, authorName: e.target.value })}
                />
              </FormField>
              <FormField label="Category">
                <input
                  className="input"
                  placeholder="Product, Engineering, Company…"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                />
              </FormField>
              <FormField label="Featured image URL">
                <input
                  className="input"
                  type="url"
                  placeholder="https://…"
                  value={form.featuredImage}
                  onChange={(e) => setForm({ ...form, featuredImage: e.target.value })}
                />
              </FormField>
            </div>
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

          <div className="space-y-4">
            <h4 className="text-xs uppercase tracking-wider text-ink-muted font-semibold">
              Post body
            </h4>
            <FormField label="Body HTML" required>
              <textarea
                required
                className="input font-mono text-xs min-h-96"
                rows={22}
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
