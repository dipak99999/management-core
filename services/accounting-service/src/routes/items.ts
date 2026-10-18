import { Router } from "express";
import { z } from "zod";
import {
  Prisma,
  prisma,
  validateCustomData,
  validateBundleDefinition,
  parseVariantAttributes,
  validateVariantMetadata,
  generateVariantCombos,
  variantCodeFor,
  variantNameFor,
  type AttributeMatrix,
} from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

export const itemRouter = Router();

const p = perms("Item");

const upsertSchema = z.object({
  itemCode: z.string().min(1),
  itemName: z.string().min(1),
  itemGroup: z.string().optional().nullable(),
  stockUom: z.string().default("Nos"),
  standardRate: z.coerce.number().default(0),
  description: z.string().optional().nullable(),
  isStockItem: z.boolean().default(true),
  // B4: PI-line for an isAsset item auto-creates draft Asset rows on submit,
  // using defaultAssetCategoryId to pick the AssetCategory (which owns the
  // asset/depreciation accounts + default useful life).
  isAsset: z.boolean().default(false),
  defaultAssetCategoryId: z.string().optional().nullable(),
  // C5: serial-tracked stock item. PR/DN routes then require explicit
  // serialNumbers[] per line.
  hasSerialNo: z.boolean().default(false),
  // C6: batch-tracked stock item. PR/DN routes require batchNo per line.
  hasBatchNo: z.boolean().default(false),
  hasExpiryDate: z.boolean().default(false),
  // C9: Quality Inspection defaults.
  inspectionRequiredBeforeReceipt: z.boolean().default(false),
  inspectionRequiredBeforeDelivery: z.boolean().default(false),
  qualityInspectionTemplateId: z.string().optional().nullable(),
  // C10: subcontracted item — PO uses default BOM to send RM to supplier.
  isSubContractedItem: z.boolean().default(false),
  // D12: Deferred revenue recognition. When true, SI submit credits the
  // tenant's Deferred Revenue liability account instead of Sales, and
  // materializes a DeferredRevenueSchedule of `deferredRevenueMonths`
  // monthly recognition rows.
  enableDeferredRevenue: z.boolean().default(false),
  deferredRevenueMonths: z.coerce.number().int().min(1).max(120).default(12),
  // Product Bundle flag. When true, the Item shows a bundle-components
  // editor and SO → DN convert expands the line into its components.
  // Components are edited via the nested /items/:id/bundle-components
  // routes; not via this upsert schema.
  isProductBundle: z.boolean().default(false),
  // Item Variants. Template = holds shared display + declares attribute
  // names via `variantAttributes` (name → "" placeholders, e.g. {"Color":"","Size":""}).
  // Variants have variantOfId set + a concrete attribute-values map.
  isVariantTemplate: z.boolean().default(false),
  variantOfId: z.string().optional().nullable().transform((v) => (v && v.length > 0 ? v : null)),
  // Storage: {Color: "Red", Size: "S"}. On template Items the values are
  // usually empty strings (they declare *which* attributes exist); on
  // variant Items the values are the concrete picks.
  variantAttributes: z.record(z.string()).optional().nullable(),
  // B11: per-item default tax templates. When a line is added to an SI/PI,
  // the UI seeds the line's taxTemplateId from the item's default (sales for
  // SI, purchase for PI). Line's own picker can still override.
  defaultSalesTaxTemplateId: z.string().optional().nullable(),
  defaultPurchaseTaxTemplateId: z.string().optional().nullable(),
  // Dropshipping: the supplier used to auto-generate a PO when a Sales
  // Order line is flagged isDropship. Optional; a null here + isDropship
  // on a line fails the SO submit with an actionable error. Empty string
  // from a UI <select value=""> is coerced to null so Prisma doesn't try
  // to FK-lookup "".
  defaultSupplierId: z
    .string()
    .optional()
    .nullable()
    .transform((v) => (v && v.length > 0 ? v : null)),
  customData: z.record(z.unknown()).optional().nullable(),
});

// Validate a template belongs to the tenant + has matching templateType.
async function validateItemTaxTemplate(
  tenantId: string,
  templateId: string | null | undefined,
  templateType: "Sales" | "Purchase",
): Promise<string | null> {
  if (!templateId) return null;
  const t = await prisma.taxTemplate.findFirst({
    where: { id: templateId, tenantId, templateType },
    select: { id: true },
  });
  if (!t)
    return `Invalid default ${templateType.toLowerCase()} tax template`;
  return null;
}

itemRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.item.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: { createdAt: "desc" },
  });
  res.json(rows);
});

itemRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.item.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

// Master detail: item + stock across all warehouses (bins) + recent SLE
// history + recent invoice usage. Gives operators one place to see "where is
// this item, how much is it, and what have we sold/bought lately".
itemRouter.get("/:id/full", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const item = await prisma.item.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!item) return res.status(404).json({ error: "Not found" });

  const [bins, recentSLE, recentSILines, recentPILines] = await Promise.all([
    prisma.bin.findMany({
      where: { tenantId, itemId: item.id },
      include: { warehouse: { select: { warehouseName: true } } },
      orderBy: { actualQty: "desc" },
    }),
    prisma.stockLedgerEntry.findMany({
      where: { tenantId, itemId: item.id, isCancelled: false },
      include: { warehouse: { select: { warehouseName: true } } },
      orderBy: { postingDate: "desc" },
      take: 30,
    }),
    prisma.salesInvoiceItem.findMany({
      where: { itemId: item.id, salesInvoice: { tenantId } },
      include: {
        salesInvoice: {
          select: {
            id: true,
            name: true,
            postingDate: true,
            status: true,
            customer: { select: { customerName: true } },
          },
        },
      },
      orderBy: { salesInvoice: { postingDate: "desc" } },
      take: 20,
    }),
    prisma.purchaseInvoiceItem.findMany({
      where: { itemId: item.id, purchaseInvoice: { tenantId } },
      include: {
        purchaseInvoice: {
          select: {
            id: true,
            name: true,
            postingDate: true,
            status: true,
            supplier: { select: { supplierName: true } },
          },
        },
      },
      orderBy: { purchaseInvoice: { postingDate: "desc" } },
      take: 20,
    }),
  ]);

  const totalQty = bins.reduce((s, b) => s + Number(b.actualQty), 0);
  const totalStockValue = bins.reduce((s, b) => s + Number(b.stockValue), 0);
  const avgRate = totalQty > 0 ? totalStockValue / totalQty : 0;

  res.json({
    item,
    stats: { totalQty, totalStockValue, avgRate },
    bins,
    recentSLE,
    recentSILines,
    recentPILines,
  });
});

// Load the template's declared attribute names (from its own
// variantAttributes JSON, treating keys as the "schema"). Used at
// variant create/update time to reject unknown attributes.
async function loadTemplateAttributeNames(
  tenantId: string,
  templateId: string,
): Promise<{ ok: true; names: string[] } | { ok: false; error: string }> {
  const template = await prisma.item.findFirst({
    where: { id: templateId, tenantId },
    select: { id: true, isVariantTemplate: true, variantAttributes: true },
  });
  if (!template) return { ok: false, error: "variantOfId does not exist for this tenant" };
  if (!template.isVariantTemplate)
    return { ok: false, error: "variantOfId points at an Item that isn't a variant template" };
  const attrs = parseVariantAttributes(template.variantAttributes);
  return { ok: true, names: attrs ? Object.keys(attrs) : [] };
}

itemRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const salesErr = await validateItemTaxTemplate(
    tenantId,
    parsed.data.defaultSalesTaxTemplateId,
    "Sales",
  );
  if (salesErr) return res.status(400).json({ error: salesErr });
  const purchErr = await validateItemTaxTemplate(
    tenantId,
    parsed.data.defaultPurchaseTaxTemplateId,
    "Purchase",
  );
  if (purchErr) return res.status(400).json({ error: purchErr });

  // Variant metadata validation. Pure helper handles the shape checks;
  // we additionally verify variantOfId belongs to this tenant + IS a
  // template (nested-templates are rejected upstream).
  let templateAttributeNames: string[] | undefined;
  if (parsed.data.variantOfId) {
    const t = await loadTemplateAttributeNames(tenantId, parsed.data.variantOfId);
    if (!t.ok) return res.status(400).json({ error: t.error });
    templateAttributeNames = t.names;
  }
  const variantErr = validateVariantMetadata({
    isVariantTemplate: parsed.data.isVariantTemplate,
    variantOfId: parsed.data.variantOfId,
    variantAttributes: parsed.data.variantAttributes,
    templateAttributeNames,
  });
  if (variantErr) return res.status(400).json({ error: variantErr });
  let customData;
  try {
    customData = await validateCustomData(
      prisma,
      tenantId,
      "Item",
      (parsed.data.customData as Record<string, unknown> | undefined) ?? undefined,
    );
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
  }
  const { customData: _drop, variantAttributes, ...rest } = parsed.data;
  try {
    const row = await prisma.item.create({
      data: {
        ...rest,
        tenantId,
        customData: customData ?? undefined,
        variantAttributes:
          variantAttributes != null
            ? (variantAttributes as Prisma.InputJsonValue)
            : undefined,
      },
    });
    res.status(201).json(row);
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes("Unique constraint")) {
      return res.status(409).json({ error: "itemCode already exists for this tenant" });
    }
    throw e;
  }
});

itemRouter.put("/:id", p.write, async (req, res) => {
  const parsed = upsertSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const existing = await prisma.item.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (parsed.data.defaultSalesTaxTemplateId !== undefined) {
    const err = await validateItemTaxTemplate(
      tenantId,
      parsed.data.defaultSalesTaxTemplateId,
      "Sales",
    );
    if (err) return res.status(400).json({ error: err });
  }
  if (parsed.data.defaultPurchaseTaxTemplateId !== undefined) {
    const err = await validateItemTaxTemplate(
      tenantId,
      parsed.data.defaultPurchaseTaxTemplateId,
      "Purchase",
    );
    if (err) return res.status(400).json({ error: err });
  }
  let customData;
  if (parsed.data.customData !== undefined) {
    try {
      customData = await validateCustomData(
        prisma,
        tenantId,
        "Item",
        parsed.data.customData as Record<string, unknown> | null,
      );
    } catch (e) {
      return res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
    }
  }

  // Variant metadata validation — mirrors the create path. Effective
  // values come from the incoming patch when set, else the existing row
  // (so an operator can PUT just {variantAttributes: {...}} without
  // re-sending the whole flag set).
  const effectiveIsTemplate =
    parsed.data.isVariantTemplate ?? existing.isVariantTemplate;
  const effectiveVariantOfId =
    parsed.data.variantOfId !== undefined
      ? parsed.data.variantOfId
      : existing.variantOfId;
  const effectiveAttrs =
    parsed.data.variantAttributes !== undefined
      ? parsed.data.variantAttributes
      : existing.variantAttributes;
  if (effectiveVariantOfId && effectiveVariantOfId === existing.id) {
    return res.status(400).json({ error: "An Item cannot be a variant of itself." });
  }
  let templateAttributeNames: string[] | undefined;
  if (effectiveVariantOfId) {
    const t = await loadTemplateAttributeNames(tenantId, effectiveVariantOfId);
    if (!t.ok) return res.status(400).json({ error: t.error });
    templateAttributeNames = t.names;
  }
  const variantErr = validateVariantMetadata({
    isVariantTemplate: effectiveIsTemplate,
    variantOfId: effectiveVariantOfId,
    variantAttributes: effectiveAttrs,
    templateAttributeNames,
  });
  if (variantErr) return res.status(400).json({ error: variantErr });

  const { customData: _drop, variantAttributes, ...rest } = parsed.data;
  const row = await prisma.item.update({
    where: { id: existing.id },
    data: {
      ...rest,
      ...(parsed.data.customData !== undefined ? { customData: customData ?? undefined } : {}),
      ...(parsed.data.variantAttributes !== undefined
        ? {
            variantAttributes:
              variantAttributes != null
                ? (variantAttributes as Prisma.InputJsonValue)
                : Prisma.JsonNull,
          }
        : {}),
    },
  });
  res.json(row);
});

itemRouter.delete("/:id", p.delete, async (req, res) => {
  const existing = await prisma.item.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.item.delete({ where: { id: existing.id } });
  res.status(204).send();
});

// ---------- Item Variants (nested under Item template) ----------
//
// GET /items/:id/variants — list every variant of a template Item, in
// itemCode order (predictable for both the admin table + the storefront
// picker). Returns the variant's attributes so the storefront can build
// the attribute-picker dropdowns without extra round-trips.
itemRouter.get("/:id/variants", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const template = await prisma.item.findFirst({
    where: { id: req.params.id, tenantId },
    select: { id: true, isVariantTemplate: true },
  });
  if (!template) return res.status(404).json({ error: "Item not found" });
  if (!template.isVariantTemplate) {
    return res
      .status(400)
      .json({ error: "Item is not a variant template — nothing to list." });
  }
  const rows = await prisma.item.findMany({
    where: { tenantId, variantOfId: template.id },
    select: {
      id: true,
      itemCode: true,
      itemName: true,
      standardRate: true,
      isStockItem: true,
      variantAttributes: true,
    },
    orderBy: { itemCode: "asc" },
  });
  res.json(rows);
});

// ---------- Product Bundle components (nested under Item) ----------
// A bundle's component list is a small dependent collection — replace-the-
// whole-list on PUT is friendlier than N create/update/delete round-trips
// and matches how the item edit drawer wants to submit changes.
//
// Gated by perms("Item").read/write — no separate BundleComponent doctype
// is needed since bundles are an aspect of an Item, not a first-class doc.

const bundleComponentSchema = z.object({
  componentItemId: z.string().min(1),
  qty: z.coerce.number().positive(),
  sortOrder: z.coerce.number().int().optional().nullable(),
});

itemRouter.get("/:id/bundle-components", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const item = await prisma.item.findFirst({
    where: { id: req.params.id, tenantId },
    select: { id: true, isProductBundle: true },
  });
  if (!item) return res.status(404).json({ error: "Item not found" });
  const rows = await prisma.bundleComponent.findMany({
    where: { tenantId, parentItemId: item.id },
    include: {
      componentItem: {
        select: { id: true, itemCode: true, itemName: true, standardRate: true },
      },
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  res.json({ isProductBundle: item.isProductBundle, components: rows });
});

itemRouter.put("/:id/bundle-components", p.write, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const parsed = z
    .object({ components: z.array(bundleComponentSchema) })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const item = await prisma.item.findFirst({
    where: { id: req.params.id, tenantId },
    select: { id: true, isProductBundle: true },
  });
  if (!item) return res.status(404).json({ error: "Item not found" });
  if (!item.isProductBundle) {
    return res
      .status(400)
      .json({ error: "Set Item.isProductBundle=true before editing components." });
  }

  // Pure helper — covered by bundle.test.ts. Catches self-reference,
  // duplicates, zero qty with friendly messages.
  const err = validateBundleDefinition({
    parentItemId: item.id,
    components: parsed.data.components,
  });
  if (err) return res.status(400).json({ error: err });

  // Confirm every componentItemId belongs to this tenant. A cross-tenant
  // Item id would slip past the unique index (it lives on the components,
  // not on the item ownership), so we check explicitly here.
  const componentIds = parsed.data.components.map((c) => c.componentItemId);
  const valid = await prisma.item.findMany({
    where: { id: { in: componentIds }, tenantId },
    select: { id: true },
  });
  if (valid.length !== new Set(componentIds).size) {
    return res
      .status(400)
      .json({ error: "One or more component items are invalid for this tenant." });
  }

  // Replace-the-list semantics — delete all, insert new, in one tx so the
  // list is never observed empty by a concurrent reader.
  const rows = await prisma.$transaction(async (tx) => {
    await tx.bundleComponent.deleteMany({
      where: { tenantId, parentItemId: item.id },
    });
    if (parsed.data.components.length > 0) {
      await tx.bundleComponent.createMany({
        data: parsed.data.components.map((c) => ({
          tenantId,
          parentItemId: item.id,
          componentItemId: c.componentItemId,
          qty: new Prisma.Decimal(c.qty),
          sortOrder: c.sortOrder ?? null,
        })),
      });
    }
    return tx.bundleComponent.findMany({
      where: { tenantId, parentItemId: item.id },
      include: {
        componentItem: {
          select: { id: true, itemCode: true, itemName: true, standardRate: true },
        },
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
  });
  res.json({ components: rows });
});

// Module 60 — Item Variant Matrix generator.
//
// POST /items/:id/generate-variants { attributes: { Color: [...], Size: [...] } }
// takes a variant TEMPLATE item + attribute matrix, generates all
// combos, and creates one child Item per combo (skipping any variant
// that already exists for the template with matching attributes).
//
// Preserves default sales/purchase templates + isStockItem from the
// template. Each variant gets its own itemCode (template-CODE-VAL1-VAL2).
const generateMatrixSchema = z.object({
  attributes: z.record(z.array(z.string().min(1)).min(1)),
});
itemRouter.post("/:id/generate-variants", p.create, async (req, res) => {
  const parsed = generateMatrixSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;

  const template = await prisma.item.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!template) return res.status(404).json({ error: "Template item not found" });
  if (!template.isVariantTemplate) {
    return res.status(400).json({ error: "Item is not a variant template" });
  }

  const combos = generateVariantCombos(parsed.data.attributes as AttributeMatrix);
  if (combos.length === 0) {
    return res.status(400).json({ error: "Empty matrix — no combos to generate" });
  }
  if (combos.length > 500) {
    return res.status(400).json({
      error: `Matrix would generate ${combos.length} variants — cap is 500 per call`,
    });
  }

  // Existing variants to skip.
  const existing = await prisma.item.findMany({
    where: { tenantId, variantOfId: template.id },
    select: { variantAttributes: true },
  });
  const existingKeys = new Set(
    existing
      .map((v) => parseVariantAttributes(v.variantAttributes))
      .filter((a): a is Record<string, string> => a !== null)
      .map((a) => JSON.stringify(sortKeys(a))),
  );

  let created = 0;
  let skipped = 0;
  const failures: Array<{ combo: Record<string, string>; error: string }> = [];

  for (const combo of combos) {
    if (existingKeys.has(JSON.stringify(sortKeys(combo)))) {
      skipped += 1;
      continue;
    }
    const code = variantCodeFor(template.itemCode, combo);
    const name = variantNameFor(template.itemName, combo);
    try {
      await prisma.item.create({
        data: {
          tenantId,
          itemCode: code,
          itemName: name,
          isStockItem: template.isStockItem,
          isVariantTemplate: false,
          variantOfId: template.id,
          variantAttributes: combo as unknown as Prisma.InputJsonValue,
          defaultSalesTaxTemplateId: template.defaultSalesTaxTemplateId,
          defaultPurchaseTaxTemplateId: template.defaultPurchaseTaxTemplateId,
          standardRate: template.standardRate,
        },
      });
      created += 1;
    } catch (e) {
      failures.push({ combo, error: e instanceof Error ? e.message : "create failed" });
    }
  }

  res.json({
    templateId: template.id,
    combos: combos.length,
    created,
    skipped,
    failures,
  });
});

function sortKeys(obj: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of Object.keys(obj).sort()) out[k] = obj[k];
  return out;
}
