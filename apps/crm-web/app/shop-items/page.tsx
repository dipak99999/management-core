"use client";

// Storefront catalog admin. One row per WebsiteItem — the web-facing
// extension of an Item. Create-new pops a drawer that lets the operator
// pick an existing Item, override its name/price for the web, add
// descriptions + images, and toggle publish. Preview button opens the
// portal-web storefront page in a new tab.

import { useEffect, useMemo, useState } from "react";
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

interface Item {
  id: string;
  itemCode: string;
  itemName: string;
  standardRate: string | number;
}

interface WebsiteItem {
  id: string;
  itemId: string;
  publicSlug: string;
  webItemName: string;
  shortDescription: string | null;
  descriptionHtml: string | null;
  imageUrl: string | null;
  galleryUrls: string[];
  webPrice: string | number | null;
  isPublished: boolean;
  publishedAt: string | null;
  updatedAt: string;
  item: { itemCode: string; itemName: string; standardRate: string | number };
}

type StatusFilter = "all" | "published" | "draft";

interface FormState {
  itemId: string;
  publicSlug: string;
  webItemName: string;
  shortDescription: string;
  descriptionHtml: string;
  imageUrl: string;
  galleryUrlsText: string;
  webPrice: string;
  isPublished: boolean;
}

const emptyForm: FormState = {
  itemId: "",
  publicSlug: "",
  webItemName: "",
  shortDescription: "",
  descriptionHtml: "",
  imageUrl: "",
  galleryUrlsText: "",
  webPrice: "",
  isPublished: false,
};

function publicUrl(slug: string): string {
  return `${PORTAL_URL}/shop/${slug}`;
}

export default function ShopItemsPage() {
  const [rows, setRows] = useState<WebsiteItem[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState>(emptyForm);
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
      setRows(await api.get<WebsiteItem[]>("/website-items"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    // We reach across services here because Items live in accounting-service.
    // A cross-service GET is fine — the crm-service admin UI already does
    // similar joins for customers on quotations.
    fetch(
      `${process.env.NEXT_PUBLIC_ACCOUNTING_SERVICE_URL ?? "/api/accounting"}/items`,
      {
        headers: {
          authorization: `Bearer ${
            typeof window !== "undefined"
              ? JSON.parse(localStorage.getItem("lumaara.session") ?? "{}").token ?? ""
              : ""
          }`,
        },
      },
    )
      .then((r) => (r.ok ? r.json() : []))
      .then((rs) => setItems(rs as Item[]))
      .catch(() => {});
  }, []);

  function openNew() {
    setForm(emptyForm);
    setEditingId(null);
    setShowForm(true);
  }

  function edit(wi: WebsiteItem, ev: React.MouseEvent) {
    ev.stopPropagation();
    setForm({
      itemId: wi.itemId,
      publicSlug: wi.publicSlug,
      webItemName: wi.webItemName,
      shortDescription: wi.shortDescription ?? "",
      descriptionHtml: wi.descriptionHtml ?? "",
      imageUrl: wi.imageUrl ?? "",
      galleryUrlsText: (wi.galleryUrls ?? []).join("\n"),
      webPrice: wi.webPrice != null ? String(wi.webPrice) : "",
      isPublished: wi.isPublished,
    });
    setEditingId(wi.id);
    setShowForm(true);
  }

  function close() {
    setForm(emptyForm);
    setEditingId(null);
    setShowForm(false);
  }

  // Auto-seed webItemName + publicSlug from the picked Item.
  function pickItem(itemId: string) {
    const it = items.find((i) => i.id === itemId);
    setForm((f) => ({
      ...f,
      itemId,
      webItemName: f.webItemName || (it?.itemName ?? ""),
      publicSlug: f.publicSlug || (it?.itemCode ?? ""),
    }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const body = {
        itemId: form.itemId,
        publicSlug: form.publicSlug,
        webItemName: form.webItemName,
        shortDescription: form.shortDescription || undefined,
        descriptionHtml: form.descriptionHtml || undefined,
        imageUrl: form.imageUrl || undefined,
        galleryUrls: form.galleryUrlsText
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
        webPrice: form.webPrice ? Number(form.webPrice) : undefined,
        isPublished: form.isPublished,
      };
      if (editingId) await api.put(`/website-items/${editingId}`, body);
      else await api.post("/website-items", body);
      close();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    }
  }

  async function remove(id: string, ev: React.MouseEvent) {
    ev.stopPropagation();
    if (!confirm("Unpublish and delete this WebsiteItem? The underlying Item is not deleted."))
      return;
    try {
      await api.del(`/website-items/${id}`);
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
    return rows.filter((r) => {
      if (statusFilter === "published" && !r.isPublished) return false;
      if (statusFilter === "draft" && r.isPublished) return false;
      if (
        q &&
        !`${r.webItemName} ${r.item.itemCode} ${r.publicSlug}`
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

  const columns: Column<WebsiteItem>[] = [
    {
      header: "Product",
      cell: (r) => (
        <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
          {r.imageUrl ? (
            // user-supplied image URL; per-tenant CDNs can't be allowlisted.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={r.imageUrl}
              alt=""
              className="w-10 h-10 rounded object-cover bg-surface-2"
            />
          ) : (
            <div className="w-10 h-10 rounded bg-surface-2 grid place-items-center text-ink-muted text-xs">
              —
            </div>
          )}
          <div className="min-w-0">
            <button
              onClick={(e) => edit(r, e)}
              className="font-medium text-ink hover:text-brand-700 text-start truncate"
            >
              {r.webItemName}
            </button>
            <div className="text-xs text-ink-muted">
              {r.item.itemCode}
              {r.shortDescription ? ` · ${r.shortDescription.slice(0, 60)}` : ""}
            </div>
          </div>
        </div>
      ),
    },
    {
      header: "Slug",
      cell: (r) => (
        <div className="flex items-center gap-1">
          <code className="font-mono text-xs text-ink-soft">/shop/{r.publicSlug}</code>
          <button
            onClick={(e) => copyUrl(r.publicSlug, e)}
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
      header: "Price",
      align: "right",
      cell: (r) => {
        const price = Number(r.webPrice ?? r.item.standardRate);
        const override = r.webPrice != null;
        return (
          <div className="tabular-nums">
            <div className={override ? "font-medium text-ink" : "text-ink-soft"}>
              {price.toFixed(2)}
            </div>
            {override && (
              <div className="text-[10px] text-ink-muted">
                Item: {Number(r.item.standardRate).toFixed(2)}
              </div>
            )}
          </div>
        );
      },
    },
    {
      header: "Status",
      cell: (r) => <StatusBadge status={r.isPublished ? "Active" : "Draft"} />,
    },
    {
      header: "Updated",
      cell: (r) => (
        <span className="text-xs text-ink-muted">{dateShort(r.updatedAt)}</span>
      ),
    },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <div className="flex justify-end gap-2">
          <a
            href={publicUrl(r.publicSlug)}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="btn-ghost btn-sm"
          >
            Preview
          </a>
          <button onClick={(e) => edit(r, e)} className="btn-ghost btn-sm">
            Edit
          </button>
          <button
            onClick={(e) => remove(r.id, e)}
            className="btn-ghost btn-sm text-red-600 hover:text-red-700"
          >
            Delete
          </button>
        </div>
      ),
    },
  ];

  const availableItems = useMemo(() => {
    const usedItemIds = new Set(
      rows.filter((r) => !editingId || r.id !== editingId).map((r) => r.itemId),
    );
    return items.filter((i) => !usedItemIds.has(i.id));
  }, [items, rows, editingId]);

  return (
    <>
      <PageHeader
        title="Shop Items"
        subtitle={
          rows.length === 0
            ? "Publish items to the public storefront at /portal/shop"
            : `${counts.published} published · ${rows.length} total`
        }
        actions={
          <Button variant="brand" onClick={openNew}>
            + Add to shop
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
            placeholder: "Search product, code, slug…",
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
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.id}
          onRowClick={(r) =>
            window.open(publicUrl(r.publicSlug), "_blank", "noreferrer")
          }
          loading={loading}
          empty={{
            icon: Icon.cart,
            title:
              search || statusFilter !== "all"
                ? "No matching items"
                : "No storefront items yet",
            description:
              search || statusFilter !== "all"
                ? "Try changing your search or filter."
                : "Pick an existing Item and publish it to your storefront.",
            action: !search && statusFilter === "all" && (
              <Button variant="brand" onClick={openNew}>
                + Add to shop
              </Button>
            ),
          }}
        />
      </div>

      <Drawer
        open={showForm}
        onClose={close}
        width="w-[720px]"
        title={editingId ? "Edit shop item" : "Add item to shop"}
        footer={
          <>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button
              variant="brand"
              onClick={(e) => save(e as unknown as React.FormEvent)}
              disabled={!form.itemId || !form.webItemName || !form.publicSlug}
            >
              {editingId ? "Save changes" : "Add to shop"}
            </Button>
          </>
        }
      >
        <form onSubmit={save} className="space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Item" required>
              <select
                required
                className="input"
                disabled={!!editingId}
                value={form.itemId}
                onChange={(e) => pickItem(e.target.value)}
              >
                <option value="">Select item…</option>
                {availableItems.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.itemCode} — {i.itemName}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Slug" required hint={publicUrl(form.publicSlug || "…")}>
              <input
                required
                className="input font-mono text-xs"
                placeholder="sku-001"
                value={form.publicSlug}
                onChange={(e) =>
                  setForm({
                    ...form,
                    publicSlug: e.target.value.replace(/[^a-zA-Z0-9-]/g, ""),
                  })
                }
              />
            </FormField>
          </div>
          <FormField label="Storefront name" required>
            <input
              required
              className="input"
              value={form.webItemName}
              onChange={(e) => setForm({ ...form, webItemName: e.target.value })}
            />
          </FormField>
          <FormField label="Short description (shown on grid cards)">
            <textarea
              className="input"
              rows={2}
              placeholder="1-2 lines"
              value={form.shortDescription}
              onChange={(e) => setForm({ ...form, shortDescription: e.target.value })}
            />
          </FormField>
          <FormField label="Long description (HTML, shown on detail page)">
            <textarea
              className="input font-mono text-xs"
              rows={8}
              placeholder="<p>Rich product description…</p>"
              value={form.descriptionHtml}
              onChange={(e) => setForm({ ...form, descriptionHtml: e.target.value })}
            />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Primary image URL">
              <input
                className="input"
                type="url"
                placeholder="https://…"
                value={form.imageUrl}
                onChange={(e) => setForm({ ...form, imageUrl: e.target.value })}
              />
            </FormField>
            <FormField
              label="Web price (override)"
              hint="Blank → uses Item's standardRate"
            >
              <input
                type="number"
                step="0.01"
                min="0"
                className="input tabular-nums"
                value={form.webPrice}
                onChange={(e) => setForm({ ...form, webPrice: e.target.value })}
              />
            </FormField>
          </div>
          <FormField
            label="Gallery URLs"
            hint="One per line. Rendered as thumbnails on the detail page."
          >
            <textarea
              className="input font-mono text-xs"
              rows={3}
              placeholder="https://…"
              value={form.galleryUrlsText}
              onChange={(e) => setForm({ ...form, galleryUrlsText: e.target.value })}
            />
          </FormField>
          <FormField label="Published">
            <label className="flex items-center gap-2 cursor-pointer h-9">
              <input
                type="checkbox"
                checked={form.isPublished}
                onChange={(e) => setForm({ ...form, isPublished: e.target.checked })}
              />
              <span className="text-sm text-ink-soft">
                {form.isPublished ? "Live on the storefront" : "Draft"}
              </span>
            </label>
          </FormField>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </>
  );
}
