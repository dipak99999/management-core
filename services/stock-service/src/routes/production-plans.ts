import { Router } from "express";
import { z } from "zod";
import { Prisma, prisma, nextName } from "@lumaara/db";
import { idempotency, perms } from "@lumaara/service-auth";

// C11: Production Plan. A plan aggregates FG production intent (SO demand
// + manual entries) and the raw materials required to satisfy it. Submit
// doesn't create Work Orders yet — the plan is a decision doc; WO
// generation is a follow-up UI action per line.

export const productionPlanRouter = Router();

const p = perms("ProductionPlan");

const itemLineSchema = z.object({
  itemId: z.string().min(1),
  plannedQty: z.coerce.number().positive(),
  salesOrderItemId: z.string().optional().nullable(),
});

const upsertSchema = z.object({
  postingDate: z.string().datetime().optional(),
  remarks: z.string().optional().nullable(),
  items: z.array(itemLineSchema).min(1),
});

productionPlanRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.productionPlan.findMany({
    where: { tenantId: req.auth!.tenantId },
    include: { items: true },
    orderBy: { postingDate: "desc" },
  });
  res.json(rows);
});

productionPlanRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.productionPlan.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      items: {
        include: { item: { select: { itemCode: true, itemName: true, stockUom: true } } },
      },
      rawMaterials: {
        include: { item: { select: { itemCode: true, itemName: true, stockUom: true } } },
      },
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

// Compute rawMaterials from FG lines using each FG's default active BOM.
// Snapshot on-hand bin qty for each RM into `availableQty`, and compute
// `shortfallQty = max(0, required - available)` for the UI. Called during
// create + explicitly via /:id/aggregate-materials to refresh after editing.
async function computeRawMaterialsData(
  tenantId: string,
  planItems: { itemId: string; plannedQty: number }[],
): Promise<
  {
    itemId: string;
    requiredQty: Prisma.Decimal;
    availableQty: Prisma.Decimal;
    shortfallQty: Prisma.Decimal;
  }[]
> {
  const rmMap = new Map<string, number>();
  for (const line of planItems) {
    const bom = await prisma.bOM.findFirst({
      where: {
        tenantId,
        productionItemId: line.itemId,
        isActive: true,
        isDefault: true,
      },
      include: { items: true },
    });
    if (!bom) continue; // items without a BOM still make the plan but don't contribute RM
    const factor = line.plannedQty / Number(bom.qty);
    for (const rm of bom.items) {
      rmMap.set(rm.itemId, (rmMap.get(rm.itemId) ?? 0) + Number(rm.qty) * factor);
    }
  }
  if (rmMap.size === 0) return [];
  const bins = await prisma.bin.groupBy({
    by: ["itemId"],
    where: { tenantId, itemId: { in: [...rmMap.keys()] } },
    _sum: { actualQty: true },
  });
  const availMap = new Map(bins.map((b) => [b.itemId, Number(b._sum.actualQty ?? 0)]));
  return [...rmMap.entries()].map(([itemId, required]) => {
    const available = availMap.get(itemId) ?? 0;
    return {
      itemId,
      requiredQty: new Prisma.Decimal(required),
      availableQty: new Prisma.Decimal(available),
      shortfallQty: new Prisma.Decimal(Math.max(0, required - available)),
    };
  });
}

productionPlanRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = parsed.data;
  const tenantId = req.auth!.tenantId;

  const itemIds = data.items.map((i) => i.itemId);
  const validItems = await prisma.item.findMany({
    where: { id: { in: itemIds }, tenantId },
    select: { id: true },
  });
  if (validItems.length !== new Set(itemIds).size)
    return res.status(400).json({ error: "One or more items are invalid" });

  const rmRows = await computeRawMaterialsData(tenantId, data.items);
  const name = await nextName(prisma, tenantId, "PP-");
  const row = await prisma.productionPlan.create({
    data: {
      tenantId,
      name,
      postingDate: data.postingDate ? new Date(data.postingDate) : new Date(),
      remarks: data.remarks ?? null,
      status: "Draft",
      items: {
        create: data.items.map((i) => ({
          itemId: i.itemId,
          plannedQty: new Prisma.Decimal(i.plannedQty),
          salesOrderItemId: i.salesOrderItemId ?? null,
        })),
      },
      rawMaterials: { create: rmRows },
    },
    include: { items: true, rawMaterials: true },
  });
  res.status(201).json(row);
});

productionPlanRouter.put("/:id", p.write, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = parsed.data;
  const tenantId = req.auth!.tenantId;

  const existing = await prisma.productionPlan.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.status !== "Draft")
    return res.status(400).json({ error: `Cannot edit plan in status ${existing.status}` });

  const rmRows = await computeRawMaterialsData(tenantId, data.items);
  const updated = await prisma.$transaction(async (tx) => {
    await tx.productionPlanItem.deleteMany({
      where: { productionPlanId: existing.id },
    });
    await tx.productionPlanRawMaterial.deleteMany({
      where: { productionPlanId: existing.id },
    });
    return tx.productionPlan.update({
      where: { id: existing.id },
      data: {
        postingDate: data.postingDate ? new Date(data.postingDate) : existing.postingDate,
        remarks: data.remarks ?? null,
        items: {
          create: data.items.map((i) => ({
            itemId: i.itemId,
            plannedQty: new Prisma.Decimal(i.plannedQty),
            salesOrderItemId: i.salesOrderItemId ?? null,
          })),
        },
        rawMaterials: { create: rmRows },
      },
      include: { items: true, rawMaterials: true },
    });
  });
  res.json(updated);
});

productionPlanRouter.post("/:id/submit", p.submit, idempotency("POST /production-plans/:id/submit"), async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const pp = await prisma.productionPlan.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!pp) return res.status(404).json({ error: "Not found" });
  if (pp.status !== "Draft")
    return res.status(400).json({ error: `Cannot submit plan in status ${pp.status}` });
  const updated = await prisma.productionPlan.update({
    where: { id: pp.id },
    data: { status: "Submitted" },
  });
  res.json(updated);
});

productionPlanRouter.post("/:id/cancel", p.cancel, idempotency("POST /production-plans/:id/cancel"), async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const pp = await prisma.productionPlan.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!pp) return res.status(404).json({ error: "Not found" });
  if (pp.status === "Cancelled") return res.status(400).json({ error: "Already cancelled" });
  const updated = await prisma.productionPlan.update({
    where: { id: pp.id },
    data: { status: "Cancelled" },
  });
  res.json(updated);
});

// Suggest FG items to add to a plan by aggregating open SO demand (any SO
// item where deliveredQty < qty). Returns [{itemId, itemName, pendingQty,
// salesOrderItemId, salesOrderName}]. UI POSTs the accepted subset to
// `POST /production-plans`.
productionPlanRouter.get("/suggest/from-sales-orders", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const soItems = await prisma.salesOrderItem.findMany({
    where: {
      salesOrder: {
        tenantId,
        status: { notIn: ["Draft", "Cancelled", "Completed"] },
      },
    },
    include: {
      salesOrder: { select: { name: true, orderDate: true } },
      item: { select: { itemCode: true, itemName: true } },
    },
  });
  const rows = soItems
    .map((i) => {
      const pending = Number(i.qty) - Number(i.deliveredQty);
      return {
        itemId: i.itemId,
        itemCode: i.item.itemCode,
        itemName: i.item.itemName,
        salesOrderItemId: i.id,
        salesOrderName: i.salesOrder.name,
        salesOrderDate: i.salesOrder.orderDate,
        pendingQty: pending,
      };
    })
    .filter((r) => r.pendingQty > 0.0001);
  res.json(rows);
});
