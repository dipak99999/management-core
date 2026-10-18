import { Router } from "express";
import { z } from "zod";
import { Prisma, prisma, nextName } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

export const bomRouter = Router();

const p = perms("BOM");

const itemLineSchema = z.object({
  itemId: z.string().min(1),
  qty: z.coerce.number().positive(),
  uom: z.string().default("Nos"),
});

// Optional routing: array of operations. hourRate is snapshotted from the
// workstation on save (so BOM cost stays stable when workstation rate changes).
const operationLineSchema = z.object({
  operationName: z.string().min(1).max(60),
  workstationId: z.string().min(1),
  timeInMins: z.coerce.number().positive(),
  sortOrder: z.coerce.number().int().default(0),
});

const createSchema = z.object({
  productionItemId: z.string().min(1),
  qty: z.coerce.number().positive().default(1),
  uom: z.string().default("Nos"),
  isActive: z.boolean().default(true),
  isDefault: z.boolean().default(true),
  items: z.array(itemLineSchema).min(1),
  operations: z.array(operationLineSchema).optional(),
});

bomRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.bOM.findMany({
    where: { tenantId: req.auth!.tenantId },
    include: {
      productionItem: { select: { itemCode: true, itemName: true } },
      items: {
        include: { item: { select: { itemCode: true, itemName: true } } },
      },
      operations: {
        include: { workstation: { select: { id: true, name: true } } },
        orderBy: { sortOrder: "asc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });
  res.json(rows);
});

bomRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.bOM.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      productionItem: true,
      items: { include: { item: true } },
      operations: {
        include: { workstation: { select: { id: true, name: true } } },
        orderBy: { sortOrder: "asc" },
      },
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

// Full detail: BOM + items + Work Orders that reference this BOM.
bomRouter.get("/:id/full", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;

  const bom = await prisma.bOM.findFirst({
    where: { id: req.params.id, tenantId },
    include: {
      productionItem: true,
      items: { include: { item: true } },
      operations: {
        include: { workstation: { select: { id: true, name: true } } },
        orderBy: { sortOrder: "asc" },
      },
    },
  });
  if (!bom) return res.status(404).json({ error: "Not found" });

  const workOrders = await prisma.workOrder.findMany({
    where: { tenantId, bomId: bom.id },
    select: {
      id: true,
      name: true,
      status: true,
      qty: true,
      producedQty: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  res.json({ bom, workOrders });
});

bomRouter.post("/", p.create, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const p = parsed.data;
  const tenantId = req.auth!.tenantId;

  const fg = await prisma.item.findFirst({
    where: { id: p.productionItemId, tenantId },
    select: { id: true, itemCode: true, isStockItem: true },
  });
  if (!fg) return res.status(400).json({ error: "Invalid production item" });
  if (!fg.isStockItem)
    return res.status(400).json({ error: "Production item must be a stock item" });

  // Validate all RM items belong to tenant + aren't the FG itself.
  const rmIds = p.items.map((i) => i.itemId);
  if (rmIds.includes(fg.id))
    return res.status(400).json({ error: "BOM cannot include its own production item" });
  const rms = await prisma.item.findMany({
    where: { id: { in: rmIds }, tenantId },
    select: { id: true },
  });
  if (rms.length !== new Set(rmIds).size)
    return res.status(400).json({ error: "One or more raw material items are invalid" });

  // If this BOM is marked default, unset default on any other active BOMs for the same FG.
  if (p.isDefault) {
    await prisma.bOM.updateMany({
      where: { tenantId, productionItemId: p.productionItemId, isDefault: true },
      data: { isDefault: false },
    });
  }

  // Validate operations (if any) — all workstations must belong to the tenant.
  // hourRate is snapshotted from the workstation so BOM cost stays stable.
  let operationSnapshots: {
    operationName: string;
    workstationId: string;
    timeInMins: number;
    hourRate: number;
    sortOrder: number;
  }[] = [];
  if (p.operations && p.operations.length > 0) {
    const wsIds = [...new Set(p.operations.map((o) => o.workstationId))];
    const workstations = await prisma.workstation.findMany({
      where: { id: { in: wsIds }, tenantId },
      select: { id: true, hourRate: true },
    });
    if (workstations.length !== wsIds.length)
      return res.status(400).json({ error: "One or more workstations not found" });
    const wsRate = new Map(workstations.map((w) => [w.id, Number(w.hourRate)]));
    operationSnapshots = p.operations.map((o, i) => ({
      operationName: o.operationName,
      workstationId: o.workstationId,
      timeInMins: o.timeInMins,
      hourRate: wsRate.get(o.workstationId) ?? 0,
      sortOrder: o.sortOrder || i,
    }));
  }

  const name = await nextName(prisma, tenantId, `BOM-${fg.itemCode}-`, 3);
  const row = await prisma.bOM.create({
    data: {
      tenantId,
      name,
      productionItemId: p.productionItemId,
      qty: p.qty,
      uom: p.uom,
      isActive: p.isActive,
      isDefault: p.isDefault,
      items: {
        create: p.items.map((i) => ({
          itemId: i.itemId,
          qty: i.qty,
          uom: i.uom,
        })),
      },
      ...(operationSnapshots.length > 0
        ? { operations: { create: operationSnapshots } }
        : {}),
    },
    include: {
      items: true,
      operations: true,
      productionItem: { select: { itemCode: true, itemName: true } },
    },
  });
  res.status(201).json(row);
});

// C13: refresh cached costs on one BOM (or all BOMs when :id === "all") from
// the current live valuation. For each BOMItem:
//   rate   = sum(bin.stockValue for this item) / sum(bin.actualQty)
//   amount = qty × rate
// Then BOM.totalCost = Σ(item.amount) + Σ(op.timeInMins × op.hourRate / 60).
async function refreshBOMCost(
  tenantId: string,
  bomId: string,
): Promise<{ bomId: string; totalCost: number }> {
  const bom = await prisma.bOM.findFirst({
    where: { id: bomId, tenantId },
    include: { items: true, operations: true },
  });
  if (!bom) throw new Error("BOM not found");
  const itemIds = bom.items.map((i) => i.itemId);
  const bins =
    itemIds.length > 0
      ? await prisma.bin.groupBy({
          by: ["itemId"],
          where: { tenantId, itemId: { in: itemIds } },
          _sum: { actualQty: true, stockValue: true },
        })
      : [];
  const rateMap = new Map<string, number>();
  for (const b of bins) {
    const qty = Number(b._sum.actualQty ?? 0);
    const value = Number(b._sum.stockValue ?? 0);
    rateMap.set(b.itemId, qty > 0 ? value / qty : 0);
  }
  let materialCost = 0;
  await prisma.$transaction(async (tx) => {
    for (const li of bom.items) {
      const rate = rateMap.get(li.itemId) ?? 0;
      const amount = Number(li.qty) * rate;
      materialCost += amount;
      await tx.bOMItem.update({
        where: { id: li.id },
        data: {
          rate: new Prisma.Decimal(rate),
          amount: new Prisma.Decimal(amount),
        },
      });
    }
    const opCost = bom.operations.reduce(
      (s, op) => s + (Number(op.timeInMins) * Number(op.hourRate)) / 60,
      0,
    );
    const total = materialCost + opCost;
    await tx.bOM.update({
      where: { id: bom.id },
      data: {
        totalCost: new Prisma.Decimal(total),
        costUpdatedAt: new Date(),
      },
    });
  });
  return { bomId: bom.id, totalCost: materialCost };
}

bomRouter.post("/:id/update-cost", p.write, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  try {
    if (req.params.id === "all") {
      const boms = await prisma.bOM.findMany({
        where: { tenantId, isActive: true },
        select: { id: true },
      });
      const results = [];
      for (const b of boms) results.push(await refreshBOMCost(tenantId, b.id));
      return res.json({ updated: results.length, results });
    }
    const result = await refreshBOMCost(tenantId, req.params.id);
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(msg === "BOM not found" ? 404 : 400).json({ error: msg });
  }
});

// C13: replace one RM item with another across every BOM in the tenant.
// Use case: substituted a component (v1 chip → v2 chip); don't want to
// hand-edit 40 BOMs.
const replaceItemSchema = z.object({
  fromItemId: z.string().min(1),
  toItemId: z.string().min(1),
});
bomRouter.post("/tools/replace-item", p.write, async (req, res) => {
  const parsed = replaceItemSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const { fromItemId, toItemId } = parsed.data;
  if (fromItemId === toItemId)
    return res.status(400).json({ error: "fromItemId and toItemId must differ" });
  const [from, to] = await Promise.all([
    prisma.item.findFirst({ where: { id: fromItemId, tenantId } }),
    prisma.item.findFirst({ where: { id: toItemId, tenantId } }),
  ]);
  if (!from || !to) return res.status(400).json({ error: "Invalid item ids" });

  // Refuse if `to` is the FG of any BOM that also has `from` as an RM (would
  // create a BOM that references its own product).
  const conflict = await prisma.bOM.findFirst({
    where: {
      tenantId,
      productionItemId: toItemId,
      items: { some: { itemId: fromItemId } },
    },
    select: { name: true },
  });
  if (conflict)
    return res.status(400).json({
      error: `Refusing replace: BOM ${conflict.name} produces the target item and would recurse`,
    });

  const affected = await prisma.bOMItem.findMany({
    where: { itemId: fromItemId, bom: { tenantId } },
    select: { id: true, bomId: true },
  });
  const bomIds = [...new Set(affected.map((r) => r.bomId))];
  await prisma.bOMItem.updateMany({
    where: { itemId: fromItemId, bom: { tenantId } },
    data: { itemId: toItemId },
  });
  // Refresh costs on the affected BOMs so cached totals reflect the swap.
  for (const b of bomIds) {
    try {
      await refreshBOMCost(tenantId, b);
    } catch {
      // ignore per-BOM failures — replacement is best-effort
    }
  }
  res.json({ replacedRows: affected.length, affectedBOMs: bomIds.length });
});
