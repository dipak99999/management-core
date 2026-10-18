import { Router } from "express";
import { z } from "zod";
import {
  Prisma,
  prisma,
  resolvePublishedAt,
  isPubliclyReadable,
} from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// ------------------------ Admin (JWT'd) -------------------------------------
// CRUD for the Website Item — the web-facing extension of an Item. A single
// Item can have at most one WebsiteItem (1:1). Deleting the WebsiteItem
// unpublishes; deleting the Item cascades to WebsiteItem.

export const websiteItemRouter = Router();
export const websiteItemPublicRouter = Router();
const p = perms("WebsiteItem");

const upsertSchema = z.object({
  itemId: z.string().min(1),
  publicSlug: z
    .string()
    .min(1)
    .max(96)
    .regex(/^[a-zA-Z0-9-]+$/, "slug must be alphanumeric + dashes"),
  webItemName: z.string().min(1).max(200),
  shortDescription: z.string().max(400).nullable().optional(),
  descriptionHtml: z.string().nullable().optional(),
  imageUrl: z.string().url().nullable().optional(),
  galleryUrls: z.array(z.string().url()).max(20).optional(),
  webPrice: z.coerce.number().nonnegative().nullable().optional(),
  isPublished: z.boolean().optional(),
});

websiteItemRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.websiteItem.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: [{ isPublished: "desc" }, { updatedAt: "desc" }],
    include: {
      item: { select: { itemCode: true, itemName: true, standardRate: true } },
    },
  });
  res.json(rows);
});

websiteItemRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.websiteItem.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      item: {
        select: {
          itemCode: true,
          itemName: true,
          standardRate: true,
          description: true,
        },
      },
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

websiteItemRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;

  const item = await prisma.item.findFirst({
    where: { id: parsed.data.itemId, tenantId },
    select: { id: true },
  });
  if (!item) return res.status(400).json({ error: "Invalid itemId" });

  try {
    const publishedAt = resolvePublishedAt(null, parsed.data.isPublished === true);
    const row = await prisma.websiteItem.create({
      data: {
        tenantId,
        itemId: item.id,
        publicSlug: parsed.data.publicSlug,
        webItemName: parsed.data.webItemName,
        shortDescription: parsed.data.shortDescription ?? null,
        descriptionHtml: parsed.data.descriptionHtml ?? null,
        imageUrl: parsed.data.imageUrl ?? null,
        galleryUrls: parsed.data.galleryUrls ?? [],
        webPrice:
          parsed.data.webPrice != null ? new Prisma.Decimal(parsed.data.webPrice) : null,
        isPublished: parsed.data.isPublished ?? false,
        publishedAt,
      },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint"))
      return res
        .status(409)
        .json({ error: "This item already has a WebsiteItem, or the slug is taken" });
    throw e;
  }
});

websiteItemRouter.put("/:id", p.write, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const existing = await prisma.websiteItem.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });

  // itemId is not editable via PUT — that would break the 1:1 link. Callers
  // must delete + recreate to relink to a different Item.
  if (parsed.data.itemId !== existing.itemId)
    return res.status(400).json({ error: "itemId cannot be changed; delete and recreate" });

  const nextPublished = parsed.data.isPublished ?? existing.isPublished;
  const publishedAt = resolvePublishedAt(existing.publishedAt, nextPublished);

  try {
    const row = await prisma.websiteItem.update({
      where: { id: existing.id },
      data: {
        publicSlug: parsed.data.publicSlug,
        webItemName: parsed.data.webItemName,
        shortDescription: parsed.data.shortDescription ?? null,
        descriptionHtml: parsed.data.descriptionHtml ?? null,
        imageUrl: parsed.data.imageUrl ?? null,
        galleryUrls: parsed.data.galleryUrls ?? [],
        webPrice:
          parsed.data.webPrice != null ? new Prisma.Decimal(parsed.data.webPrice) : null,
        isPublished: nextPublished,
        publishedAt,
      },
    });
    res.json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint"))
      return res.status(409).json({ error: "Slug already in use" });
    throw e;
  }
});

websiteItemRouter.delete("/:id", p.delete, async (req, res) => {
  await prisma.websiteItem.deleteMany({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  res.status(204).end();
});

// ------------------------ Public (no auth) ----------------------------------

// GET /public/shop — published storefront index. Excludes descriptionHtml to
// keep the payload light; grids only need title, price, thumbnail, teaser.
websiteItemPublicRouter.get("/", async (_req, res) => {
  const rows = await prisma.websiteItem.findMany({
    where: { isPublished: true },
    select: {
      id: true,
      publicSlug: true,
      webItemName: true,
      shortDescription: true,
      imageUrl: true,
      webPrice: true,
      item: {
        select: { itemCode: true, standardRate: true },
      },
    },
    orderBy: { publishedAt: "desc" },
    take: 200,
  });
  res.json(
    rows.map((r) => ({
      // `id` is included so the cart page can hydrate (localStorage stores
      // ids added from the /shop/:slug detail page). Safe to expose — it's
      // the same DB id already returned by the detail endpoint.
      id: r.id,
      slug: r.publicSlug,
      itemCode: r.item.itemCode,
      name: r.webItemName,
      shortDescription: r.shortDescription,
      imageUrl: r.imageUrl,
      price: Number(r.webPrice ?? r.item.standardRate),
    })),
  );
});

// GET /public/shop/:slug — single product detail (full descriptionHtml).
websiteItemPublicRouter.get("/:slug", async (req, res) => {
  const wi = await prisma.websiteItem.findUnique({
    where: { publicSlug: req.params.slug },
    include: {
      item: {
        select: {
          itemCode: true,
          standardRate: true,
          description: true,
          isVariantTemplate: true,
          variants: {
            select: {
              id: true,
              itemCode: true,
              itemName: true,
              standardRate: true,
              variantAttributes: true,
            },
            orderBy: { itemCode: "asc" },
          },
        },
      },
    },
  });
  if (!isPubliclyReadable(wi))
    return res.status(404).json({ error: "Not found" });
  res.json({
    id: wi.id,
    slug: wi.publicSlug,
    itemId: wi.itemId,
    itemCode: wi.item.itemCode,
    name: wi.webItemName,
    shortDescription: wi.shortDescription,
    // Prefer web-authored descriptionHtml; else fall back to the plain Item
    // description wrapped in a <p> so the renderer can inject it verbatim.
    descriptionHtml:
      wi.descriptionHtml ??
      (wi.item.description ? `<p>${escapeHtml(wi.item.description)}</p>` : ""),
    imageUrl: wi.imageUrl,
    galleryUrls: wi.galleryUrls,
    price: Number(wi.webPrice ?? wi.item.standardRate),
    // Item Variants. When the underlying Item is a variant template, we
    // return every variant so the storefront can render attribute pickers
    // and resolve the customer's selection to a specific variantItemId at
    // add-to-cart time. Variant prices override the template's base price
    // — customer sees the resolved variant price after picking.
    isVariantTemplate: wi.item.isVariantTemplate,
    variants: wi.item.isVariantTemplate
      ? wi.item.variants.map((v) => ({
          itemId: v.id,
          itemCode: v.itemCode,
          itemName: v.itemName,
          price: Number(v.standardRate),
          attributes:
            v.variantAttributes && typeof v.variantAttributes === "object"
              ? v.variantAttributes
              : {},
        }))
      : [],
  });
});

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) =>
    (({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }) as Record<string, string>)[ch]!,
  );
}
