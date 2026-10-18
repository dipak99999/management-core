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
  StatusBadge,
  Toast,
  dateShort,
  type Column,
} from "../../components/ui";
import { Icon } from "../../components/app-shell";

interface Article {
  id: string;
  title: string;
  slug: string;
  status: string;
  publishedAt: string | null;
  viewCount: number;
  tags: string[];
  category: { name: string } | null;
}
interface Category { id: string; name: string; slug: string; }

// Module 52 — Knowledge Base article list + create + publish.
export default function KBArticlesPage() {
  const [rows, setRows] = useState<Article[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    categoryId: "",
    title: "",
    slug: "",
    bodyMarkdown: "",
    tags: "",
  });

  async function load() {
    setLoading(true);
    try {
      const [a, c] = await Promise.all([
        api.get<Article[]>("/kb-articles"),
        api.get<Category[]>("/kb-categories"),
      ]);
      setRows(a);
      setCategories(c);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  useListPageCommands({
    singular: "Kb Article",
    plural: "Kb Articles",
    refresh: load,
  });
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/kb-articles", {
        categoryId: form.categoryId || null,
        title: form.title,
        slug: form.slug,
        bodyMarkdown: form.bodyMarkdown,
        tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
      });
      setShowForm(false);
      setForm({ categoryId: "", title: "", slug: "", bodyMarkdown: "", tags: "" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  async function publish(a: Article, e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await api.post(`/kb-articles/${a.id}/publish`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  async function archive(a: Article, e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await api.post(`/kb-articles/${a.id}/archive`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.slug.toLowerCase().includes(q) ||
        r.tags.some((t) => t.includes(q)),
    );
  }, [rows, search]);

  const columns: Column<Article>[] = [
    {
      header: "Title",
      cell: (r) => (
        <div>
          <div className="font-medium text-ink">{r.title}</div>
          <div className="text-xs text-ink-muted font-mono">{r.slug}</div>
        </div>
      ),
    },
    { header: "Category", cell: (r) => <span className="text-sm">{r.category?.name ?? "—"}</span> },
    {
      header: "Tags",
      cell: (r) => (
        <div className="flex flex-wrap gap-1">
          {r.tags.map((t) => <span key={t} className="badge text-xs">{t}</span>)}
        </div>
      ),
    },
    { header: "Views", align: "right", cell: (r) => <span className="font-mono">{r.viewCount}</span> },
    { header: "Published", cell: (r) => <span className="text-xs text-ink-muted">{r.publishedAt ? dateShort(r.publishedAt) : "—"}</span> },
    { header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <div className="flex items-center justify-end gap-1">
          {r.status === "Draft" && (
            <button onClick={(e) => publish(r, e)} className="btn-ghost btn-sm">Publish</button>
          )}
          {r.status === "Published" && (
            <button onClick={(e) => archive(r, e)} className="btn-ghost btn-sm">Archive</button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Knowledge Base"
        subtitle="Published articles are suggested on ticket create + visible in the portal."
        actions={<Button variant="brand" onClick={() => setShowForm(true)}>+ New article</Button>}
      />

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}

      <div className="space-y-4">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search title / tag…" }}
          actions={<SavedViewsControls listKey="crm-web:kb-articles" current={{ search }} onApply={(fv) => setSearch(fv.search)} />}
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.id}
          loading={loading}
          empty={{
            icon: Icon.book,
            title: search ? "No matches" : "No articles yet",
            description: "Write helpful articles that get suggested to customers when they open a ticket.",
            action: !search && <Button variant="brand" onClick={() => setShowForm(true)}>+ New article</Button>,
          }}
        />
      </div>

      <Drawer
        open={showForm}
        onClose={() => setShowForm(false)}
        title="New article"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button variant="brand" onClick={(e) => submit(e as unknown as React.FormEvent)}>Create draft</Button>
          </>
        }
      >
        <form onSubmit={submit} className="space-y-4">
          <FormField label="Title" required>
            <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
          </FormField>
          <FormField label="Slug" required hint="URL-friendly identifier">
            <input className="input font-mono" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-") })} required />
          </FormField>
          <FormField label="Category">
            <select className="input" value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
              <option value="">— uncategorized —</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </FormField>
          <FormField label="Tags" hint="Comma-separated, lowercase">
            <input className="input" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
          </FormField>
          <FormField label="Body (Markdown)" required>
            <textarea className="input font-mono text-sm" rows={12} value={form.bodyMarkdown} onChange={(e) => setForm({ ...form, bodyMarkdown: e.target.value })} required />
          </FormField>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </>
  );
}
