import { Router } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// C7: per-item UOM conversion factors. e.g. stockUom="Nos", uom="Dozen",
// conversionFactor=12. Transactions can carry an alternate UOM per line;
// server converts to stockQty for SLE/Bin math.

export const itemUOMConversionRouter = Router();

// Reuse Item permission gating — UOM conversion is an item-level config.
const p = perms("Item");

const upsertSchema = z.object({
  itemId: z.string().min(1),
  uom: z.string().min(1),
  conversionFactor: z.coerce.number().positive(),
});

itemUOMConversionRouter.get("/", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const itemId = typeof req.query.itemId === "string" ? req.query.itemId : undefined;
  const rows = await prisma.itemUOMConversion.findMany({
    where: { tenantId, ...(itemId ? { itemId } : {}) },
    include: { item: { select: { itemCode: true, itemName: true, stockUom: true } } },
    orderBy: [{ item: { itemCode: "asc" } }, { uom: "asc" }],
  });
  res.json(rows);
});

itemUOMConversionRouter.post("/", p.write, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const item = await prisma.item.findFirst({
    where: { id: parsed.data.itemId, tenantId },
  });
  if (!item) return res.status(400).json({ error: "Invalid item" });
  try {
    const row = await prisma.itemUOMConversion.create({
      data: {
        tenantId,
        itemId: parsed.data.itemId,
        uom: parsed.data.uom,
        conversionFactor: new Prisma.Decimal(parsed.data.conversionFactor),
      },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint"))
      return res.status(409).json({ error: "Conversion already exists for this item + UOM" });
    throw e;
  }
});

itemUOMConversionRouter.put("/:id", p.write, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.itemUOMConversion.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const row = await prisma.itemUOMConversion.update({
    where: { id: existing.id },
    data: {
      uom: parsed.data.uom,
      conversionFactor: new Prisma.Decimal(parsed.data.conversionFactor),
    },
  });
  res.json(row);
});

itemUOMConversionRouter.delete("/:id", p.write, async (req, res) => {
  const existing = await prisma.itemUOMConversion.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.itemUOMConversion.delete({ where: { id: existing.id } });
  res.status(204).send();
});
