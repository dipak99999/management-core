import { Router } from "express";
import { z } from "zod";
import { prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

export const warehouseRouter = Router();

const p = perms("Warehouse");

const upsertSchema = z.object({
  warehouseName: z.string().min(1),
  parentId: z.string().optional().nullable(),
  isGroup: z.boolean().default(false),
  disabled: z.boolean().default(false),
});

warehouseRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.warehouse.findMany({
    where: { tenantId: req.auth!.tenantId, disabled: false },
    orderBy: { warehouseName: "asc" },
  });
  res.json(rows);
});

warehouseRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.warehouse.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

// Master detail: warehouse + all bins here + recent SLE at this warehouse.
warehouseRouter.get("/:id/full", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const warehouse = await prisma.warehouse.findFirst({
    where: { id: req.params.id, tenantId },
    include: {
      parent: { select: { id: true, warehouseName: true } },
      children: { select: { id: true, warehouseName: true } },
    },
  });
  if (!warehouse) return res.status(404).json({ error: "Not found" });

  const [bins, recentSLE] = await Promise.all([
    prisma.bin.findMany({
      where: { tenantId, warehouseId: warehouse.id, actualQty: { not: 0 } },
      include: { item: { select: { itemCode: true, itemName: true, stockUom: true } } },
      orderBy: { stockValue: "desc" },
    }),
    prisma.stockLedgerEntry.findMany({
      where: { tenantId, warehouseId: warehouse.id, isCancelled: false },
      include: { item: { select: { itemCode: true, itemName: true, stockUom: true } } },
      orderBy: { postingDate: "desc" },
      take: 30,
    }),
  ]);

  const totalStockValue = bins.reduce((s, b) => s + Number(b.stockValue), 0);

  res.json({
    warehouse,
    stats: { totalStockValue, distinctItems: bins.length },
    bins,
    recentSLE,
  });
});

warehouseRouter.put("/:id", p.write, async (req, res) => {
  const parsed = upsertSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const p = parsed.data;
  const tenantId = req.auth!.tenantId;

  const existing = await prisma.warehouse.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });

  if (p.parentId !== undefined && p.parentId !== null) {
    if (p.parentId === existing.id)
      return res.status(400).json({ error: "Warehouse cannot be its own parent" });
    const parent = await prisma.warehouse.findFirst({
      where: { id: p.parentId, tenantId },
    });
    if (!parent) return res.status(400).json({ error: "Invalid parent warehouse" });
    if (!parent.isGroup) return res.status(400).json({ error: "Parent must be a group" });
  }

  // Guard isGroup flips against invariants.
  if (p.isGroup !== undefined && p.isGroup !== existing.isGroup) {
    if (existing.isGroup && !p.isGroup) {
      const childCount = await prisma.warehouse.count({
        where: { tenantId, parentId: existing.id },
      });
      if (childCount > 0)
        return res.status(400).json({ error: "Cannot un-group: warehouse has children" });
    }
    if (!existing.isGroup && p.isGroup) {
      const stockedBin = await prisma.bin.findFirst({
        where: { tenantId, warehouseId: existing.id, actualQty: { not: 0 } },
        select: { id: true },
      });
      if (stockedBin)
        return res.status(400).json({ error: "Cannot convert to group: warehouse holds stock" });
    }
  }

  try {
    const row = await prisma.warehouse.update({ where: { id: existing.id }, data: p });
    res.json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint")) {
      return res.status(409).json({ error: "Warehouse name already exists" });
    }
    throw e;
  }
});

warehouseRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const p = parsed.data;

  if (p.parentId) {
    const parent = await prisma.warehouse.findFirst({
      where: { id: p.parentId, tenantId: req.auth!.tenantId },
    });
    if (!parent) return res.status(400).json({ error: "Invalid parent warehouse" });
    if (!parent.isGroup) return res.status(400).json({ error: "Parent must be a group" });
  }

  try {
    const row = await prisma.warehouse.create({
      data: { ...p, tenantId: req.auth!.tenantId },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint")) {
      return res.status(409).json({ error: "Warehouse name already exists" });
    }
    throw e;
  }
});
