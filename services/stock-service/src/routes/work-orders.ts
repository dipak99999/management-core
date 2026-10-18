import { Router } from "express";
import { z } from "zod";
import { Prisma, prisma, nextName } from "@lumaara/db";
import { cancelStockEntries, postManufactureEntry } from "../lib/stock-posting";
import { idempotency, perms, publishRealtime } from "@lumaara/service-auth";

export const workOrderRouter = Router();

const p = perms("WorkOrder");

const createSchema = z.object({
  bomId: z.string().min(1),
  qty: z.coerce.number().positive(),
  sourceWarehouseId: z.string().min(1),
  targetWarehouseId: z.string().min(1),
  remarks: z.string().optional().nullable(),
});

workOrderRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.workOrder.findMany({
    where: { tenantId: req.auth!.tenantId },
    include: {
      bom: { select: { name: true } },
      productionItem: { select: { itemCode: true, itemName: true } },
      sourceWarehouse: { select: { warehouseName: true } },
      targetWarehouse: { select: { warehouseName: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  res.json(rows);
});

workOrderRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.workOrder.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      bom: { include: { items: { include: { item: true } } } },
      productionItem: true,
      sourceWarehouse: true,
      targetWarehouse: true,
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

// Full detail: WO + BOM + all SLEs posted against this WO (spans multiple
// manufacture runs — each `POST /:id/manufacture` writes SLEs with this WO's id
// as voucherId). Client groups by (createdAt bucket) to render batches.
workOrderRouter.get("/:id/full", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;

  const wo = await prisma.workOrder.findFirst({
    where: { id: req.params.id, tenantId },
    include: {
      bom: { include: { items: { include: { item: true } } } },
      productionItem: true,
      sourceWarehouse: true,
      targetWarehouse: true,
      operations: {
        include: { workstation: { select: { id: true, name: true } } },
        orderBy: { sortOrder: "asc" },
      },
    },
  });
  if (!wo) return res.status(404).json({ error: "Not found" });

  const slEntries = await prisma.stockLedgerEntry.findMany({
    where: {
      tenantId,
      voucherType: "WorkOrder",
      voucherId: wo.id,
      isCancelled: false,
    },
    include: {
      item: { select: { itemCode: true, itemName: true, stockUom: true } },
      warehouse: { select: { warehouseName: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  res.json({ workOrder: wo, slEntries });
});

// Update a Work Order that hasn't started manufacturing yet. Once any qty has
// been produced (producedQty > 0) or status has advanced past "Not Started",
// the record is frozen — reversing partial manufacturing is out of scope for
// edit; use /cancel-and-reverse then create a new WO.
workOrderRouter.put("/:id", p.write, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const p = parsed.data;
  const tenantId = req.auth!.tenantId;

  const existing = await prisma.workOrder.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.status !== "Not Started")
    return res.status(400).json({ error: `Cannot edit WO in status ${existing.status}` });
  if (Number(existing.producedQty) > 0)
    return res.status(400).json({ error: "Cannot edit: manufacturing has already begun" });

  const bom = await prisma.bOM.findFirst({
    where: { id: p.bomId, tenantId, isActive: true },
  });
  if (!bom) return res.status(400).json({ error: "Invalid or inactive BOM" });

  if (p.sourceWarehouseId === p.targetWarehouseId)
    return res.status(400).json({ error: "Source and target warehouses must differ" });

  const [source, target] = await Promise.all([
    prisma.warehouse.findFirst({
      where: { id: p.sourceWarehouseId, tenantId, isGroup: false },
    }),
    prisma.warehouse.findFirst({
      where: { id: p.targetWarehouseId, tenantId, isGroup: false },
    }),
  ]);
  if (!source || !target)
    return res.status(400).json({ error: "Invalid source or target warehouse" });

  const updated = await prisma.workOrder.update({
    where: { id: existing.id },
    data: {
      bomId: bom.id,
      productionItemId: bom.productionItemId,
      qty: p.qty,
      sourceWarehouseId: p.sourceWarehouseId,
      targetWarehouseId: p.targetWarehouseId,
      remarks: p.remarks ?? null,
    },
    include: {
      bom: { select: { name: true } },
      productionItem: { select: { itemCode: true, itemName: true } },
    },
  });
  res.json(updated);
});

workOrderRouter.post("/", p.create, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const p = parsed.data;
  const tenantId = req.auth!.tenantId;

  const bom = await prisma.bOM.findFirst({
    where: { id: p.bomId, tenantId, isActive: true },
    include: { operations: { orderBy: { sortOrder: "asc" } } },
  });
  if (!bom) return res.status(400).json({ error: "Invalid or inactive BOM" });

  if (p.sourceWarehouseId === p.targetWarehouseId)
    return res.status(400).json({ error: "Source and target warehouses must differ" });

  const [source, target] = await Promise.all([
    prisma.warehouse.findFirst({
      where: { id: p.sourceWarehouseId, tenantId, isGroup: false },
    }),
    prisma.warehouse.findFirst({
      where: { id: p.targetWarehouseId, tenantId, isGroup: false },
    }),
  ]);
  if (!source || !target)
    return res.status(400).json({ error: "Invalid source or target warehouse" });

  // Scale BOM operations to WO.qty: BOM time is per BOM.qty units, so per-WO
  // time = bomOp.timeInMins × (WO.qty / BOM.qty).
  const scale = Number(p.qty) / Number(bom.qty);
  const woOperations = bom.operations.map((op) => ({
    operationName: op.operationName,
    workstationId: op.workstationId,
    timeInMins: new Prisma.Decimal(Number(op.timeInMins) * scale),
    hourRate: op.hourRate,
    sortOrder: op.sortOrder,
  }));

  const name = await nextName(prisma, tenantId, "WO-");
  const row = await prisma.workOrder.create({
    data: {
      tenantId,
      name,
      bomId: bom.id,
      productionItemId: bom.productionItemId,
      qty: p.qty,
      producedQty: 0,
      sourceWarehouseId: p.sourceWarehouseId,
      targetWarehouseId: p.targetWarehouseId,
      status: "Not Started",
      remarks: p.remarks ?? null,
      ...(woOperations.length > 0
        ? { operations: { create: woOperations } }
        : {}),
    },
    include: {
      bom: { select: { name: true } },
      productionItem: { select: { itemCode: true, itemName: true } },
      operations: true,
    },
  });
  res.status(201).json(row);
});

// Manufacture N units of the finished good against this Work Order.
// Consumes raw materials proportionally from the BOM, produces N FG.
// Rolls back atomically if raw material stock is insufficient.
const manufactureSchema = z.object({
  qtyToManufacture: z.coerce.number().positive(),
});

workOrderRouter.post("/:id/manufacture", p.submit, async (req, res) => {
  const parsed = manufactureSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const qtyToManufacture = parsed.data.qtyToManufacture;
  const tenantId = req.auth!.tenantId;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const wo = await tx.workOrder.findFirst({
        where: { id: req.params.id, tenantId },
        include: { bom: { include: { items: true } } },
      });
      if (!wo) throw new Error("Not found");
      if (wo.status === "Cancelled" || wo.status === "Completed")
        throw new Error(`Cannot manufacture on Work Order in status ${wo.status}`);

      const remaining = new Prisma.Decimal(wo.qty).sub(wo.producedQty);
      const request = new Prisma.Decimal(qtyToManufacture);
      if (request.gt(remaining))
        throw new Error(
          `Cannot produce ${qtyToManufacture}; only ${remaining.toString()} remaining on ${wo.name}`,
        );

      const bomYield = new Prisma.Decimal(wo.bom.qty); // BOM yields this many FG per run
      // Ratio: for producing qtyToManufacture, multiply each BOM RM by (qtyToManufacture / bomYield)
      const ratio = request.div(bomYield);

      const consumeLines = wo.bom.items.map((bi) => ({
        itemId: bi.itemId,
        warehouseId: wo.sourceWarehouseId,
        qty: Number(new Prisma.Decimal(bi.qty).mul(ratio)),
      }));
      const produceLines = [
        {
          itemId: wo.productionItemId,
          warehouseId: wo.targetWarehouseId,
          qty: qtyToManufacture,
        },
      ];

      const posted = await postManufactureEntry(tx, {
        tenantId,
        postingDate: new Date(),
        voucherType: "WorkOrder",
        voucherId: wo.id,
        voucherName: wo.name,
        consumeLines,
        produceLines,
      });

      const newProduced = new Prisma.Decimal(wo.producedQty).add(request);
      const newStatus = newProduced.gte(wo.qty) ? "Completed" : "In Process";

      const updated = await tx.workOrder.update({
        where: { id: wo.id },
        data: { producedQty: newProduced, status: newStatus },
      });

      return { workOrder: updated, ...posted };
    });
    void publishRealtime(tenantId, "work-order", { id: result.workOrder.id, status: result.workOrder.status });
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(msg === "Not found" ? 404 : 400).json({ error: msg });
  }
});

workOrderRouter.post("/:id/cancel", p.cancel, idempotency("POST /work-orders/:id/cancel"), async (req, res) => {
  const tenantId = req.auth!.tenantId;
  try {
    const wo = await prisma.workOrder.findFirst({
      where: { id: req.params.id, tenantId },
    });
    if (!wo) return res.status(404).json({ error: "Not found" });
    if (wo.status === "Cancelled") return res.status(400).json({ error: "Already cancelled" });

    // Note: this cancels the Work Order but does NOT reverse any manufacturing
    // that already happened. Each manufacturing run posts SLEs against this WO's
    // voucherId — those SLEs can be reversed by calling
    // cancelStockEntries({ voucherType: "WorkOrder", voucherId: wo.id })
    // when you want a full reversal. For now we leave that as an explicit choice.
    const updated = await prisma.workOrder.update({
      where: { id: wo.id },
      data: { status: "Cancelled" },
    });
    void publishRealtime(tenantId, "work-order", { id: updated.id, status: "Cancelled" });
    res.json(updated);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
  }
});

// Full reversal: cancel WO AND reverse all manufacturing SLEs it posted.
workOrderRouter.post("/:id/cancel-and-reverse", p.cancel, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const wo = await tx.workOrder.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!wo) throw new Error("Not found");
      if (wo.status === "Cancelled") throw new Error("Already cancelled");

      await cancelStockEntries(tx, {
        tenantId,
        voucherType: "WorkOrder",
        voucherId: wo.id,
      });

      return tx.workOrder.update({
        where: { id: wo.id },
        data: { status: "Cancelled", producedQty: 0 },
      });
    });
    void publishRealtime(tenantId, "work-order", { id: result.id, status: "Cancelled" });
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(msg === "Not found" ? 404 : 400).json({ error: msg });
  }
});
