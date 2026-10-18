import { Router } from "express";
import { z } from "zod";
import { prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// Module 49 — Item Alternate routes.
//
// Maintains the (primary, alternate) substitution graph. Also serves
// the resolver endpoint that the PO/SO create UI calls when suggesting
// substitutes for out-of-stock items.

export const itemAlternateRouter = Router();
const p = perms("Item");

const upsertSchema = z.object({
  itemId: z.string().min(1),
  alternateItemId: z.string().min(1),
  twoWay: z.boolean().default(false),
  priority: z.coerce.number().int().min(0).default(100),
  notes: z.string().max(500).optional().nullable(),
});

itemAlternateRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.itemAlternate.findMany({
    where: { tenantId: req.auth!.tenantId },
    include: {
      item: { select: { itemCode: true, itemName: true } },
      alternateItem: { select: { itemCode: true, itemName: true } },
    },
    orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
  });
  res.json(rows);
});

// Resolver used by PO/SO create UI. GET /suggest?itemId=xxx returns
// the alternates for that primary item, ordered by priority, including
// reverse pairs when the reverse is flagged twoWay.
itemAlternateRouter.get("/suggest", p.read, async (req, res) => {
  const itemId = typeof req.query.itemId === "string" ? req.query.itemId : null;
  if (!itemId) return res.status(400).json({ error: "itemId query param required" });
  const tenantId = req.auth!.tenantId;

  const [forward, reverseTwoWay] = await Promise.all([
    prisma.itemAlternate.findMany({
      where: { tenantId, itemId },
      include: { alternateItem: { select: { id: true, itemCode: true, itemName: true } } },
      orderBy: { priority: "asc" },
    }),
    prisma.itemAlternate.findMany({
      where: { tenantId, alternateItemId: itemId, twoWay: true },
      include: { item: { select: { id: true, itemCode: true, itemName: true } } },
      orderBy: { priority: "asc" },
    }),
  ]);

  const alternates = [
    ...forward.map((r) => ({
      id: r.id,
      alternateItemId: r.alternateItem.id,
      itemCode: r.alternateItem.itemCode,
      itemName: r.alternateItem.itemName,
      priority: r.priority,
      notes: r.notes,
      direction: "forward" as const,
    })),
    ...reverseTwoWay.map((r) => ({
      id: r.id,
      alternateItemId: r.item.id,
      itemCode: r.item.itemCode,
      itemName: r.item.itemName,
      priority: r.priority,
      notes: r.notes,
      direction: "reverse" as const,
    })),
  ];
  alternates.sort((a, b) => a.priority - b.priority);
  res.json({ itemId, alternates });
});

itemAlternateRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;
  const tenantId = req.auth!.tenantId;

  if (b.itemId === b.alternateItemId) {
    return res.status(400).json({ error: "An item cannot substitute itself" });
  }
  const items = await prisma.item.count({
    where: { id: { in: [b.itemId, b.alternateItemId] }, tenantId },
  });
  if (items !== 2) return res.status(400).json({ error: "One or both items not found" });

  try {
    const row = await prisma.itemAlternate.create({
      data: {
        tenantId,
        itemId: b.itemId,
        alternateItemId: b.alternateItemId,
        twoWay: b.twoWay,
        priority: b.priority,
        notes: b.notes ?? null,
      },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint")) {
      return res.status(409).json({ error: "This substitute pair already exists" });
    }
    throw e;
  }
});

itemAlternateRouter.put("/:id", p.write, async (req, res) => {
  const parsed = upsertSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;
  const tenantId = req.auth!.tenantId;
  const existing = await prisma.itemAlternate.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const row = await prisma.itemAlternate.update({
    where: { id: existing.id },
    data: {
      ...(b.twoWay !== undefined ? { twoWay: b.twoWay } : {}),
      ...(b.priority !== undefined ? { priority: b.priority } : {}),
      ...(b.notes !== undefined ? { notes: b.notes } : {}),
    },
  });
  res.json(row);
});

itemAlternateRouter.delete("/:id", p.create, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const existing = await prisma.itemAlternate.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.itemAlternate.delete({ where: { id: existing.id } });
  res.json({ ok: true });
});
