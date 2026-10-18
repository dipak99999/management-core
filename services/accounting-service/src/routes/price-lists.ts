import { Router } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// C4: Price Lists + Item Prices. A PriceList is a named catalog (Selling or
// Buying, in a specific currency). ItemPrice rows attach a rate to (item,
// price list) with optional validity window. SI/PI/PO/Quotation UIs pick a
// PriceList and look up the effective rate on item selection.

export const priceListRouter = Router();
export const itemPriceRouter = Router();

const p = perms("PriceList");

const priceListSchema = z.object({
  name: z.string().min(1),
  currency: z.string().default("INR"),
  buyingOrSelling: z.enum(["Buying", "Selling"]).default("Selling"),
  isDefault: z.boolean().default(false),
  enabled: z.boolean().default(true),
});

priceListRouter.get("/", p.read, async (req, res) => {
  const type =
    typeof req.query.type === "string" ? req.query.type : undefined;
  const rows = await prisma.priceList.findMany({
    where: {
      tenantId: req.auth!.tenantId,
      ...(type ? { buyingOrSelling: type } : {}),
    },
    orderBy: [{ buyingOrSelling: "asc" }, { name: "asc" }],
  });
  res.json(rows);
});

priceListRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.priceList.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

priceListRouter.post("/", p.create, async (req, res) => {
  const parsed = priceListSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const row = await prisma.priceList.create({
      data: { ...parsed.data, tenantId: req.auth!.tenantId },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint"))
      return res.status(409).json({ error: "Price list name already exists" });
    throw e;
  }
});

priceListRouter.put("/:id", p.write, async (req, res) => {
  const parsed = priceListSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.priceList.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const row = await prisma.priceList.update({
    where: { id: existing.id },
    data: parsed.data,
  });
  res.json(row);
});

priceListRouter.delete("/:id", p.delete, async (req, res) => {
  const existing = await prisma.priceList.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: { _count: { select: { prices: true } } },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing._count.prices > 0)
    return res.status(400).json({
      error: `Cannot delete: has ${existing._count.prices} item prices — remove them first`,
    });
  await prisma.priceList.delete({ where: { id: existing.id } });
  res.status(204).send();
});

// ---------- Item Prices ----------

const pi = perms("PriceList"); // shares the PriceList doctype for permission gating

const itemPriceSchema = z.object({
  itemId: z.string().min(1),
  priceListId: z.string().min(1),
  priceListRate: z.coerce.number().nonnegative(),
  validFrom: z.string().datetime().optional().nullable(),
  validUpto: z.string().datetime().optional().nullable(),
});

itemPriceRouter.get("/", pi.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const itemId = typeof req.query.itemId === "string" ? req.query.itemId : undefined;
  const priceListId =
    typeof req.query.priceListId === "string" ? req.query.priceListId : undefined;
  const rows = await prisma.itemPrice.findMany({
    where: {
      tenantId,
      ...(itemId ? { itemId } : {}),
      ...(priceListId ? { priceListId } : {}),
    },
    include: {
      item: { select: { itemCode: true, itemName: true } },
      priceList: { select: { name: true, currency: true, buyingOrSelling: true } },
    },
    orderBy: [{ item: { itemCode: "asc" } }, { priceList: { name: "asc" } }],
  });
  res.json(rows);
});

// Effective-rate lookup for a specific (item, priceList) at an optional
// posting date. Picks the latest ItemPrice whose validity window includes
// the date (or the newest overall when no windows are set).
itemPriceRouter.get("/lookup", pi.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const itemId = typeof req.query.itemId === "string" ? req.query.itemId : "";
  const priceListId =
    typeof req.query.priceListId === "string" ? req.query.priceListId : "";
  if (!itemId || !priceListId)
    return res.status(400).json({ error: "itemId + priceListId required" });
  const at =
    typeof req.query.at === "string" ? new Date(req.query.at) : new Date();
  const candidates = await prisma.itemPrice.findMany({
    where: {
      tenantId,
      itemId,
      priceListId,
      OR: [
        { validFrom: null, validUpto: null },
        { validFrom: { lte: at }, validUpto: null },
        { validFrom: null, validUpto: { gte: at } },
        { validFrom: { lte: at }, validUpto: { gte: at } },
      ],
    },
    orderBy: [{ validFrom: "desc" }, { updatedAt: "desc" }],
    take: 1,
  });
  if (candidates.length === 0) return res.json({ rate: null });
  res.json({ rate: Number(candidates[0].priceListRate) });
});

itemPriceRouter.post("/", pi.create, async (req, res) => {
  const parsed = itemPriceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const [item, pl] = await Promise.all([
    prisma.item.findFirst({ where: { id: parsed.data.itemId, tenantId } }),
    prisma.priceList.findFirst({ where: { id: parsed.data.priceListId, tenantId } }),
  ]);
  if (!item) return res.status(400).json({ error: "Invalid item" });
  if (!pl) return res.status(400).json({ error: "Invalid price list" });
  const row = await prisma.itemPrice.create({
    data: {
      tenantId,
      itemId: parsed.data.itemId,
      priceListId: parsed.data.priceListId,
      priceListRate: new Prisma.Decimal(parsed.data.priceListRate),
      validFrom: parsed.data.validFrom ? new Date(parsed.data.validFrom) : null,
      validUpto: parsed.data.validUpto ? new Date(parsed.data.validUpto) : null,
    },
  });
  res.status(201).json(row);
});

itemPriceRouter.put("/:id", pi.write, async (req, res) => {
  const parsed = itemPriceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.itemPrice.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const row = await prisma.itemPrice.update({
    where: { id: existing.id },
    data: {
      itemId: parsed.data.itemId,
      priceListId: parsed.data.priceListId,
      priceListRate: new Prisma.Decimal(parsed.data.priceListRate),
      validFrom: parsed.data.validFrom ? new Date(parsed.data.validFrom) : null,
      validUpto: parsed.data.validUpto ? new Date(parsed.data.validUpto) : null,
    },
  });
  res.json(row);
});

itemPriceRouter.delete("/:id", pi.delete, async (req, res) => {
  const existing = await prisma.itemPrice.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.itemPrice.delete({ where: { id: existing.id } });
  res.status(204).send();
});
