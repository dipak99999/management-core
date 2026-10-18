"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "../../lib/api";
import { CustomFieldsForm } from "../../lib/custom-fields";
import {
  Button,
  DataTable,
  Drawer,
  FilterBar,
  FormField,
  PageHeader,
  Toast,
  money,
  type Column,
} from "../../components/ui";
import { Icon } from "../../components/app-shell";

interface Item {
  id: string;
  itemCode: string;
  itemName: string;
  itemGroup: string | null;
  stockUom: string;
  standardRate: string;
  isStockItem: boolean;
  isAsset: boolean;
  defaultAssetCategoryId: string | null;
  defaultSalesTaxTemplateId: string | null;
  defaultPurchaseTaxTemplateId: string | null;
  defaultSupplierId: string | null;
  hasSerialNo: boolean;
  hasBatchNo: boolean;
  hasExpiryDate: boolean;
  inspectionRequiredBeforeReceipt: boolean;
  inspectionRequiredBeforeDelivery: boolean;
  qualityInspectionTemplateId: string | null;
  isSubContractedItem: boolean;
  isProductBundle: boolean;
  // Item Variants. Templates declare attribute names via variantAttributes
  // as {"Color":"","Size":""} (values are placeholders). Variants set
  // variantOfId + concrete attribute values.
  isVariantTemplate: boolean;
  variantOfId: string | null;
  variantAttributes: Record<string, string> | null;
  description: string | null;
  customData?: Record<string, unknown> | null;
}

interface BundleComponentRow {
  id: string;
  componentItemId: string;
  qty: string;
  sortOrder: number | null;
  componentItem: {
    id: string;
    itemCode: string;
    itemName: string;
    standardRate: string;
  };
}

const emptyForm = {
  itemCode: "",
  itemName: "",
  itemGroup: "",
  stockUom: "Nos",
  standardRate: 0,
  isStockItem: true,
  isAsset: false,
  defaultAssetCategoryId: "",
  defaultSalesTaxTemplateId: "",
  defaultPurchaseTaxTemplateId: "",
  defaultSupplierId: "",
  hasSerialNo: false,
  hasBatchNo: false,
  hasExpiryDate: false,
  inspectionRequiredBeforeReceipt: false,
  inspectionRequiredBeforeDelivery: false,
  qualityInspectionTemplateId: "",
  isSubContractedItem: false,
  isProductBundle: false,
  isVariantTemplate: false,
  variantOfId: "",
  // Attribute pairs shown as a list in the editor (name + value). Empty
  // value means the entry is an attribute *name* on a template; non-empty
  // means it's a concrete pick on a variant.
  variantAttributes: [] as { name: string; value: string }[],
  description: "",
  // Revenue-recognition: when enabled, sales-invoice lines with this item
  // book to a deferred-revenue account and get spread across N months via
  // the deferred-revenue scheduler job.
  enableDeferredRevenue: false,
  deferredRevenueMonths: 12,
};

interface AssetCategoryLite {
  id: string;
  categoryName: string;
}

interface TaxTemplateLite {
  id: string;
  name: string;
  templateType: "Sales" | "Purchase";
}

interface QITemplateLite {
  id: string;
  name: string;
}

interface SupplierLite {
  id: string;
  supplierName: string;
}

async function loadQITemplates(): Promise<QITemplateLite[]> {
  const STOCK =
    process.env.NEXT_PUBLIC_STOCK_SERVICE_URL ?? "/api/stock";
  const raw = localStorage.getItem("lumaara.session");
  const token = raw ? (JSON.parse(raw).token as string) : "";
  const res = await fetch(`${STOCK}/quality-inspection-templates`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to load QI templates (${res.status})`);
  return res.json();
}

function InnerItemsPage() {
  const searchParams = useSearchParams();
  const editId = searchParams.get("editId");

  const [rows, setRows] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [customData, setCustomData] = useState<Record<string, unknown>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [assetCategories, setAssetCategories] = useState<AssetCategoryLite[]>([]);
  const [taxTemplates, setTaxTemplates] = useState<TaxTemplateLite[]>([]);
  const [qiTemplates, setQITemplates] = useState<QITemplateLite[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierLite[]>([]);
  // Bundle components — a small child collection managed inside the item
  // drawer. Nested draft: `bundleComponents` is the current edit state,
  // synced to the server on save via PUT /items/:id/bundle-components.
  const [bundleComponents, setBundleComponents] = useState<
    { componentItemId: string; qty: string; sortOrder: number | null }[]
  >([]);
  const [search, setSearch] = useState("");

  async function load() {
    setLoading(true);
    try {
      setRows(await api.get<Item[]>("/items"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    api.get<AssetCategoryLite[]>("/asset-categories").then(setAssetCategories).catch(() => {});
    api.get<TaxTemplateLite[]>("/tax-templates").then(setTaxTemplates).catch(() => {});
    api.get<SupplierLite[]>("/suppliers").then(setSuppliers).catch(() => {});
    loadQITemplates().then(setQITemplates).catch(() => {});
  }, []);

  useEffect(() => {
    if (!editId) return;
    api
      .get<Item>(`/items/${editId}`)
      .then((it) => {
        setForm({
          itemCode: it.itemCode,
          itemName: it.itemName,
          itemGroup: it.itemGroup ?? "",
          stockUom: it.stockUom,
          standardRate: Number(it.standardRate),
          isStockItem: it.isStockItem,
          isAsset: it.isAsset,
          defaultAssetCategoryId: it.defaultAssetCategoryId ?? "",
          defaultSalesTaxTemplateId: it.defaultSalesTaxTemplateId ?? "",
          defaultPurchaseTaxTemplateId: it.defaultPurchaseTaxTemplateId ?? "",
          defaultSupplierId: it.defaultSupplierId ?? "",
          isProductBundle: it.isProductBundle ?? false,
          isVariantTemplate: it.isVariantTemplate ?? false,
          variantOfId: it.variantOfId ?? "",
          // Prisma returns variantAttributes as a JSON object; the form
          // edits it as an array of {name, value} pairs so the operator
          // can reorder / add / remove rows without JSON syntax gymnastics.
          variantAttributes: it.variantAttributes
            ? Object.entries(it.variantAttributes).map(([name, value]) => ({
                name,
                value: String(value ?? ""),
              }))
            : [],
          hasSerialNo: it.hasSerialNo,
          hasBatchNo: it.hasBatchNo,
          hasExpiryDate: it.hasExpiryDate,
          inspectionRequiredBeforeReceipt: it.inspectionRequiredBeforeReceipt,
          inspectionRequiredBeforeDelivery: it.inspectionRequiredBeforeDelivery,
          qualityInspectionTemplateId: it.qualityInspectionTemplateId ?? "",
          isSubContractedItem: it.isSubContractedItem,
          description: it.description ?? "",
          enableDeferredRevenue:
            (it as { enableDeferredRevenue?: boolean }).enableDeferredRevenue ?? false,
          deferredRevenueMonths:
            (it as { deferredRevenueMonths?: number }).deferredRevenueMonths ?? 12,
        });
        setCustomData((it.customData as Record<string, unknown>) ?? {});
        setEditingId(editId);
        setShowForm(true);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
    // Fire off a separate fetch for the bundle-component list. Only used
    // when the item is a bundle; otherwise the state stays empty and the
    // editor section stays hidden.
    api
      .get<{ components: BundleComponentRow[] }>(`/items/${editId}/bundle-components`)
      .then((r) =>
        setBundleComponents(
          r.components.map((c) => ({
            componentItemId: c.componentItemId,
            qty: c.qty,
            sortOrder: c.sortOrder,
          })),
        ),
      )
      .catch(() => setBundleComponents([]));
  }, [editId]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      // Serialize the form's array-of-pairs into the server's Record shape.
      // Rows with an empty name are dropped (accidental extras); rows on a
      // template keep their value even if blank (that IS the schema —
      // "Color" as a declared attribute without a preset value).
      const variantAttrs: Record<string, string> = {};
      for (const p of form.variantAttributes) {
        if (p.name.trim().length === 0) continue;
        variantAttrs[p.name.trim()] = p.value;
      }
      const payload = {
        ...form,
        defaultAssetCategoryId: form.defaultAssetCategoryId || null,
        defaultSalesTaxTemplateId: form.defaultSalesTaxTemplateId || null,
        defaultPurchaseTaxTemplateId: form.defaultPurchaseTaxTemplateId || null,
        defaultSupplierId: form.defaultSupplierId || null,
        qualityInspectionTemplateId: form.qualityInspectionTemplateId || null,
        variantOfId: form.variantOfId || null,
        variantAttributes:
          Object.keys(variantAttrs).length > 0 ? variantAttrs : null,
        customData,
      };
      let savedItemId: string;
      if (editingId) {
        await api.put(`/items/${editingId}`, payload);
        savedItemId = editingId;
      } else {
        const created = await api.post<{ id: string }>("/items", payload);
        savedItemId = created.id;
      }
      // If the item is a bundle, sync the component list. The nested route
      // will validate (self-ref, dups, zero qty) and refuse if the item
      // isn't flagged bundle — safe to always call when the flag is on.
      if (form.isProductBundle) {
        await api.put(`/items/${savedItemId}/bundle-components`, {
          components: bundleComponents
            .filter((c) => c.componentItemId && Number(c.qty) > 0)
            .map((c) => ({
              componentItemId: c.componentItemId,
              qty: Number(c.qty),
              sortOrder: c.sortOrder,
            })),
        });
      }
      close();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    }
  }

  function close() {
    setForm(emptyForm);
    setCustomData({});
    setBundleComponents([]);
    setEditingId(null);
    setShowForm(false);
    if (editId) window.history.replaceState({}, "", "/accounting/items");
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.itemCode, r.itemName, r.itemGroup]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [rows, search]);

  const columns: Column<Item>[] = [
    {
      header: "Code",
      cell: (r) => (
        <a
          href={`/accounting/items/${r.id}`}
          className="font-mono text-sm text-brand-600 hover:text-brand-700"
          onClick={(e) => e.stopPropagation()}
        >
          {r.itemCode}
        </a>
      ),
    },
    { header: "Name", cell: (r) => <span className="font-medium text-ink">{r.itemName}</span> },
    { header: "Group", cell: (r) => <span className="text-ink-soft">{r.itemGroup ?? "—"}</span> },
    { header: "UOM", cell: (r) => <span className="text-ink-soft">{r.stockUom}</span> },
    {
      header: "Rate",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums font-medium text-ink">
          {money(Number(r.standardRate))}
        </span>
      ),
    },
    {
      header: "Type",
      cell: (r) => (
        <span className={r.isStockItem ? "badge-brand" : "badge-gray"}>
          {r.isStockItem ? "Stock" : "Service"}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Items"
        subtitle={`${rows.length} item${rows.length === 1 ? "" : "s"}`}
        actions={
          <Button variant="brand" onClick={() => setShowForm(true)}>+ New item</Button>
        }
      />

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}

      <div className="space-y-4">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search code, name, group…" }}
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.id}
          onRowClick={(r) => (window.location.href = `/accounting/items/${r.id}`)}
          loading={loading}
          empty={{
            icon: Icon.box,
            title: search ? "No matches" : "No items yet",
            description: search
              ? "Try a different search term."
              : "Add your first item to your catalog.",
            action: !search && (
              <Button variant="brand" onClick={() => setShowForm(true)}>+ Add item</Button>
            ),
          }}
        />
      </div>

      <Drawer
        open={showForm}
        onClose={close}
        title={editingId ? "Edit item" : "New item"}
        width="w-[640px]"
        footer={
          <>
            <Button variant="secondary" onClick={close}>Cancel</Button>
            <Button variant="brand" onClick={(e) => save(e as unknown as React.FormEvent)}>
              {editingId ? "Save changes" : "Create item"}
            </Button>
          </>
        }
      >
        <form onSubmit={save} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Item code" required>
              <input
                className="input"
                placeholder="WIDGET-01"
                value={form.itemCode}
                onChange={(e) => setForm({ ...form, itemCode: e.target.value })}
                required
                autoFocus
              />
            </FormField>
            <FormField label="Unit (UOM)" required>
              <input
                className="input"
                placeholder="Nos, Kg, ..."
                value={form.stockUom}
                onChange={(e) => setForm({ ...form, stockUom: e.target.value })}
                required
              />
            </FormField>
          </div>
          <FormField label="Item name" required>
            <input
              className="input"
              placeholder="Widget"
              value={form.itemName}
              onChange={(e) => setForm({ ...form, itemName: e.target.value })}
              required
            />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Item group">
              <input
                className="input"
                placeholder="Optional"
                value={form.itemGroup}
                onChange={(e) => setForm({ ...form, itemGroup: e.target.value })}
              />
            </FormField>
            <FormField label="Standard rate">
              <input
                type="number"
                step="any"
                min={0}
                className="input"
                value={form.standardRate}
                onChange={(e) => setForm({ ...form, standardRate: Number(e.target.value) })}
              />
            </FormField>
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.isStockItem}
                onChange={(e) => setForm({ ...form, isStockItem: e.target.checked })}
              />
              Is stock item
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.isAsset}
                onChange={(e) => setForm({ ...form, isAsset: e.target.checked })}
              />
              Is fixed asset
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.hasSerialNo}
                onChange={(e) => setForm({ ...form, hasSerialNo: e.target.checked })}
              />
              Serial-tracked
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.hasBatchNo}
                onChange={(e) => setForm({ ...form, hasBatchNo: e.target.checked })}
              />
              Batch-tracked
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.hasExpiryDate}
                onChange={(e) => setForm({ ...form, hasExpiryDate: e.target.checked })}
              />
              Has expiry
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.isSubContractedItem}
                onChange={(e) => setForm({ ...form, isSubContractedItem: e.target.checked })}
              />
              Subcontracted
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.isProductBundle}
                onChange={(e) => setForm({ ...form, isProductBundle: e.target.checked })}
              />
              Product bundle
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.isVariantTemplate}
                disabled={!!form.variantOfId}
                onChange={(e) =>
                  setForm({ ...form, isVariantTemplate: e.target.checked })
                }
                title={
                  form.variantOfId
                    ? "This Item is a variant of another. Clear 'Variant of' first."
                    : ""
                }
              />
              Variant template
            </label>
          </div>

          {(form.isVariantTemplate || form.variantOfId) && (
            <div className="border-t border-ink-muted/10 pt-4 space-y-3">
              <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
                Item Variants
              </div>
              {!form.isVariantTemplate && (
                <FormField
                  label="Variant of"
                  hint="Pick the template Item this is a variant of."
                >
                  <select
                    className="input"
                    value={form.variantOfId}
                    onChange={(e) =>
                      setForm({ ...form, variantOfId: e.target.value })
                    }
                  >
                    <option value="">— None —</option>
                    {rows
                      .filter((i) => i.isVariantTemplate && i.id !== editingId)
                      .map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.itemCode} — {i.itemName}
                        </option>
                      ))}
                  </select>
                </FormField>
              )}
              <div className="flex items-center justify-between">
                <div className="text-xs text-ink-muted">
                  {form.isVariantTemplate
                    ? "Declare attribute names (e.g. Color, Size). Values left blank on the template."
                    : "Fill each attribute value for this variant (e.g. Color=Red, Size=S)."}
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setForm({
                      ...form,
                      variantAttributes: [
                        ...form.variantAttributes,
                        { name: "", value: "" },
                      ],
                    })
                  }
                  className="btn-ghost btn-sm"
                >
                  + Add attribute
                </button>
              </div>
              {form.variantAttributes.length === 0 && (
                <div className="text-xs text-ink-muted italic">
                  No attributes yet.
                </div>
              )}
              <div className="space-y-2">
                {form.variantAttributes.map((pair, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                    <input
                      className="input col-span-5"
                      placeholder="Attribute (e.g. Color)"
                      value={pair.name}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          variantAttributes: form.variantAttributes.map((p, i) =>
                            i === idx ? { ...p, name: e.target.value } : p,
                          ),
                        })
                      }
                    />
                    <input
                      className="input col-span-6"
                      placeholder={
                        form.isVariantTemplate ? "(blank on template)" : "Value (e.g. Red)"
                      }
                      value={pair.value}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          variantAttributes: form.variantAttributes.map((p, i) =>
                            i === idx ? { ...p, value: e.target.value } : p,
                          ),
                        })
                      }
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setForm({
                          ...form,
                          variantAttributes: form.variantAttributes.filter(
                            (_, i) => i !== idx,
                          ),
                        })
                      }
                      className="col-span-1 text-ink-muted hover:text-red-600 text-sm"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {form.isProductBundle && (
            <div className="border-t border-ink-muted/10 pt-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
                  Bundle components
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setBundleComponents([
                      ...bundleComponents,
                      { componentItemId: "", qty: "1", sortOrder: bundleComponents.length + 1 },
                    ])
                  }
                  className="btn-ghost btn-sm"
                >
                  + Add component
                </button>
              </div>
              <p className="text-xs text-ink-muted">
                On SO → Delivery Note convert, this bundle line explodes into
                these components. The bundle itself does not move as stock.
              </p>
              {bundleComponents.length === 0 && (
                <div className="text-xs text-ink-muted italic">
                  No components yet. Click "+ Add component" to build the pack list.
                </div>
              )}
              <div className="space-y-2">
                {bundleComponents.map((c, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                    <select
                      className="input col-span-8"
                      value={c.componentItemId}
                      onChange={(e) =>
                        setBundleComponents(
                          bundleComponents.map((r, i) =>
                            i === idx ? { ...r, componentItemId: e.target.value } : r,
                          ),
                        )
                      }
                    >
                      <option value="">Select component item…</option>
                      {rows
                        // A bundle can't contain itself + shouldn't offer
                        // items already picked in another line of this
                        // bundle (dedup UX; server double-checks).
                        .filter(
                          (i) =>
                            i.id !== editingId &&
                            !bundleComponents.some(
                              (b, j) => j !== idx && b.componentItemId === i.id,
                            ),
                        )
                        .map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.itemCode} — {i.itemName}
                          </option>
                        ))}
                    </select>
                    <input
                      type="number"
                      step="any"
                      min={0.0001}
                      className="input col-span-3 tabular-nums"
                      value={c.qty}
                      onChange={(e) =>
                        setBundleComponents(
                          bundleComponents.map((r, i) =>
                            i === idx ? { ...r, qty: e.target.value } : r,
                          ),
                        )
                      }
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setBundleComponents(bundleComponents.filter((_, i) => i !== idx))
                      }
                      className="col-span-1 text-ink-muted hover:text-red-600 text-sm"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="border-t border-ink-muted/10 pt-4 space-y-3">
            <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">Quality Inspection</div>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.inspectionRequiredBeforeReceipt}
                  onChange={(e) => setForm({ ...form, inspectionRequiredBeforeReceipt: e.target.checked })}
                />
                Required before receipt
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.inspectionRequiredBeforeDelivery}
                  onChange={(e) => setForm({ ...form, inspectionRequiredBeforeDelivery: e.target.checked })}
                />
                Required before delivery
              </label>
            </div>
            <FormField label="Default QI template">
              <select
                className="input"
                value={form.qualityInspectionTemplateId}
                onChange={(e) => setForm({ ...form, qualityInspectionTemplateId: e.target.value })}
              >
                <option value="">— None —</option>
                {qiTemplates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </FormField>
          </div>
          {form.isAsset && (
            <FormField
              label="Default asset category"
              hint="PI submit will spawn draft Assets here"
              required
            >
              <select
                required
                className="input"
                value={form.defaultAssetCategoryId}
                onChange={(e) => setForm({ ...form, defaultAssetCategoryId: e.target.value })}
              >
                <option value="">Select category…</option>
                {assetCategories.map((c) => (
                  <option key={c.id} value={c.id}>{c.categoryName}</option>
                ))}
              </select>
            </FormField>
          )}
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Default sales tax">
              <select
                className="input"
                value={form.defaultSalesTaxTemplateId}
                onChange={(e) => setForm({ ...form, defaultSalesTaxTemplateId: e.target.value })}
              >
                <option value="">— None —</option>
                {taxTemplates
                  .filter((t) => t.templateType === "Sales")
                  .map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
              </select>
            </FormField>
            <FormField label="Default purchase tax">
              <select
                className="input"
                value={form.defaultPurchaseTaxTemplateId}
                onChange={(e) => setForm({ ...form, defaultPurchaseTaxTemplateId: e.target.value })}
              >
                <option value="">— None —</option>
                {taxTemplates
                  .filter((t) => t.templateType === "Purchase")
                  .map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
              </select>
            </FormField>
          </div>
          <FormField
            label="Default supplier (dropship)"
            hint="Used to auto-create a Purchase Order when a Sales Order line is flagged Dropship."
          >
            <select
              className="input"
              value={form.defaultSupplierId}
              onChange={(e) => setForm({ ...form, defaultSupplierId: e.target.value })}
            >
              <option value="">— None —</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.supplierName}</option>
              ))}
            </select>
          </FormField>
          <FormField label="Description">
            <textarea
              className="input"
              rows={3}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </FormField>
          <FormField
            label=""
            hint="When enabled, sales-invoice lines for this item book to a deferred-revenue liability and get spread across N months by the recognition scheduler."
          >
            <label className="inline-flex items-center gap-2 text-sm text-ink-soft">
              <input
                type="checkbox"
                checked={form.enableDeferredRevenue}
                onChange={(e) => setForm({ ...form, enableDeferredRevenue: e.target.checked })}
              />
              Enable deferred revenue recognition
            </label>
          </FormField>
          {form.enableDeferredRevenue && (
            <FormField label="Recognition period (months)">
              <input
                className="input"
                type="number"
                min={1}
                max={120}
                step={1}
                value={form.deferredRevenueMonths}
                onChange={(e) =>
                  setForm({ ...form, deferredRevenueMonths: Number(e.target.value) || 12 })
                }
              />
            </FormField>
          )}
          <CustomFieldsForm doctype="Item" value={customData} onChange={setCustomData} />
          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </>
  );
}

export default function ItemsPage() {
  return (
    <Suspense fallback={null}>
      <InnerItemsPage />
    </Suspense>
  );
}
