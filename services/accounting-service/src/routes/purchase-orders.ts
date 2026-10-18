import { Router } from "express";
import { z } from "zod";
import {
  Prisma,
  prisma,
  nextName,
  resolveTaxTemplate,
  computeInvoiceTaxLines,
} from "@lumaara/db";
import { idempotency, perms, publishRealtime } from "@lumaara/service-auth";

// C1: Purchase Order. An intent to buy — no stock/GL impact until PR/PI.
//   Lifecycle: Draft → Submitted → To Receive → Completed | Cancelled.
//   Tax rows are snapshotted at PO create/update time (same pattern as SI/PI).
//   `receivedQty` on line items auto-tallies from linked PR items.

export const purchaseOrderRouter = Router();

const p = perms("PurchaseOrder");

const itemLineSchema = z.object({
  itemId: z.string().min(1),
  qty: z.coerce.number().positive(),
  rate: z.coerce.number().nonnegative(),
  warehouseId: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  taxTemplateId: z.string().optional().nullable(),
  // C2: backlink to MRItem — tally MR.orderedQty on PO submit.
  materialRequestItemId: z.string().optional().nullable(),
});

const upsertSchema = z.object({
  supplierId: z.string().min(1),
  transactionDate: z.string().datetime().optional(),
  deliveryDate: z.string().datetime().optional().nullable(),
  currency: z.string().default("INR"),
  conversionRate: z.coerce.number().positive().default(1),
  taxTemplateId: z.string().optional().nullable(),
  remarks: z.string().optional().nullable(),
  // C10: subcontracting.
  isSubcontracted: z.boolean().default(false),
  supplierWarehouseId: z.string().optional().nullable(),
  sourceWarehouseId: z.string().optional().nullable(),
  items: z.array(itemLineSchema).min(1),
});

purchaseOrderRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.purchaseOrder.findMany({
    where: { tenantId: req.auth!.tenantId },
    include: {
      supplier: { select: { supplierName: true } },
      items: true,
    },
    orderBy: { transactionDate: "desc" },
  });
  res.json(rows);
});

purchaseOrderRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.purchaseOrder.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      supplier: true,
      items: {
        include: {
          item: { select: { itemCode: true, itemName: true, stockUom: true } },
          warehouse: { select: { warehouseName: true } },
        },
      },
      taxes: { include: { account: { select: { accountName: true } } } },
      taxTemplate: true,
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

async function loadTemplatesAndBuild(
  tenantId: string,
  data: z.infer<typeof upsertSchema>,
) {
  const templateIds = Array.from(
    new Set(
      [
        data.taxTemplateId ?? null,
        ...data.items.map((i) => i.taxTemplateId ?? null),
      ].filter((v): v is string => !!v),
    ),
  );
  const templateMap = new Map<string, Awaited<ReturnType<typeof resolveTaxTemplate>>>();
  for (const id of templateIds) {
    templateMap.set(id, await resolveTaxTemplate(prisma, tenantId, id, "Purchase"));
  }
  const invoiceLevelTemplate = data.taxTemplateId
    ? templateMap.get(data.taxTemplateId) ?? null
    : null;
  const lines = data.items.map((i) => ({
    itemId: i.itemId,
    qty: new Prisma.Decimal(i.qty),
    rate: new Prisma.Decimal(i.rate),
    amount: new Prisma.Decimal(i.qty).mul(new Prisma.Decimal(i.rate)),
    warehouseId: i.warehouseId ?? null,
    description: i.description ?? null,
    taxTemplateId: i.taxTemplateId ?? null,
    materialRequestItemId: i.materialRequestItemId ?? null,
  }));
  const netTotal = lines.reduce((s, l) => s.add(l.amount), new Prisma.Decimal(0));
  const taxLines = computeInvoiceTaxLines(
    lines.map((l) => ({ amount: l.amount, taxTemplateId: l.taxTemplateId })),
    data.taxTemplateId ?? null,
    (id) => templateMap.get(id ?? "")?.rows ?? null,
  );
  const totalTaxes = taxLines.reduce(
    (s, l) => s.add(l.taxAmount),
    new Prisma.Decimal(0),
  );
  const grandTotal = netTotal.add(totalTaxes);
  return { lines, netTotal, totalTaxes, grandTotal, taxLines, invoiceLevelTemplate };
}

async function validateSupplierAndItems(
  tenantId: string,
  data: z.infer<typeof upsertSchema>,
): Promise<string | null> {
  const supplier = await prisma.supplier.findFirst({
    where: { id: data.supplierId, tenantId },
  });
  if (!supplier) return "Invalid supplier";
  const itemIds = data.items.map((i) => i.itemId);
  const validItems = await prisma.item.findMany({
    where: { id: { in: itemIds }, tenantId },
    select: { id: true },
  });
  if (validItems.length !== new Set(itemIds).size)
    return "One or more items are invalid for this tenant";
  const warehouseIds = [
    ...new Set(data.items.map((i) => i.warehouseId).filter((v): v is string => !!v)),
  ];
  if (warehouseIds.length > 0) {
    const whs = await prisma.warehouse.findMany({
      where: { id: { in: warehouseIds }, tenantId, disabled: false, isGroup: false },
      select: { id: true },
    });
    if (whs.length !== warehouseIds.length)
      return "One or more warehouses are invalid (must be leaf, non-disabled)";
  }
  return null;
}

purchaseOrderRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = parsed.data;
  const tenantId = req.auth!.tenantId;

  const err = await validateSupplierAndItems(tenantId, data);
  if (err) return res.status(400).json({ error: err });

  let built: Awaited<ReturnType<typeof loadTemplatesAndBuild>>;
  try {
    built = await loadTemplatesAndBuild(tenantId, data);
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
  }

  const name = await nextName(prisma, tenantId, "PO-");
  const row = await prisma.purchaseOrder.create({
    data: {
      tenantId,
      name,
      supplierId: data.supplierId,
      transactionDate: data.transactionDate ? new Date(data.transactionDate) : new Date(),
      deliveryDate: data.deliveryDate ? new Date(data.deliveryDate) : null,
      currency: data.currency,
      conversionRate: new Prisma.Decimal(data.conversionRate),
      taxTemplateId: built.invoiceLevelTemplate?.id ?? null,
      remarks: data.remarks ?? null,
      isSubcontracted: data.isSubcontracted,
      supplierWarehouseId: data.supplierWarehouseId ?? null,
      sourceWarehouseId: data.sourceWarehouseId ?? null,
      netTotal: built.netTotal,
      totalTaxes: built.totalTaxes,
      grandTotal: built.grandTotal,
      status: "Draft",
      items: { create: built.lines },
      taxes: built.taxLines.length
        ? {
            create: built.taxLines.map((r) => ({
              description: r.description,
              rate: r.rate,
              taxAmount: r.taxAmount,
              accountId: r.accountId,
              chargeType: r.chargeType,
              taxTemplateId: r.taxTemplateId ?? built.invoiceLevelTemplate?.id ?? null,
            })),
          }
        : undefined,
    },
    include: { items: true, taxes: true },
  });
  res.status(201).json(row);
});

purchaseOrderRouter.put("/:id", p.write, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = parsed.data;
  const tenantId = req.auth!.tenantId;

  const existing = await prisma.purchaseOrder.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.status !== "Draft")
    return res.status(400).json({ error: `Cannot edit PO in status ${existing.status}` });

  const err = await validateSupplierAndItems(tenantId, data);
  if (err) return res.status(400).json({ error: err });

  let built: Awaited<ReturnType<typeof loadTemplatesAndBuild>>;
  try {
    built = await loadTemplatesAndBuild(tenantId, data);
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: existing.id } });
    await tx.purchaseOrderTax.deleteMany({ where: { purchaseOrderId: existing.id } });
    return tx.purchaseOrder.update({
      where: { id: existing.id },
      data: {
        supplierId: data.supplierId,
        transactionDate: data.transactionDate
          ? new Date(data.transactionDate)
          : existing.transactionDate,
        deliveryDate: data.deliveryDate ? new Date(data.deliveryDate) : null,
        currency: data.currency,
        conversionRate: new Prisma.Decimal(data.conversionRate),
        taxTemplateId: built.invoiceLevelTemplate?.id ?? null,
        remarks: data.remarks ?? null,
        isSubcontracted: data.isSubcontracted,
        supplierWarehouseId: data.supplierWarehouseId ?? null,
        sourceWarehouseId: data.sourceWarehouseId ?? null,
        netTotal: built.netTotal,
        totalTaxes: built.totalTaxes,
        grandTotal: built.grandTotal,
        items: { create: built.lines },
        taxes: built.taxLines.length
          ? {
              create: built.taxLines.map((r) => ({
                description: r.description,
                rate: r.rate,
                taxAmount: r.taxAmount,
                accountId: r.accountId,
                chargeType: r.chargeType,
                taxTemplateId: r.taxTemplateId ?? built.invoiceLevelTemplate?.id ?? null,
              })),
            }
          : undefined,
      },
      include: { items: true, taxes: true },
    });
  });
  res.json(updated);
});

purchaseOrderRouter.post("/:id/submit", p.submit, idempotency("POST /purchase-orders/:id/submit"), async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const result = await prisma.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.findFirst({
      where: { id: req.params.id, tenantId },
      include: {
        items: {
          include: {
            item: { select: { isSubContractedItem: true, itemCode: true } },
          },
        },
      },
    });
    if (!po) throw new Error("Not found");
    if (po.status !== "Draft")
      throw new Error(`Cannot submit PO in status ${po.status}`);

    // C10: for subcontracted PO, validate setup so the UI can then trigger
    // the RM transfer StockEntry cross-service.
    if (po.isSubcontracted) {
      if (!po.supplierWarehouseId || !po.sourceWarehouseId)
        throw new Error(
          "Subcontracted PO requires both supplierWarehouseId and sourceWarehouseId",
        );
      const nonSub = po.items.find((i) => !i.item.isSubContractedItem);
      if (nonSub)
        throw new Error(
          `Line item ${nonSub.item.itemCode} is not marked as subcontracted`,
        );
      // Batch BOM lookup: one query covers every line's productionItemId.
      // The previous per-line findFirst was O(lines) round-trips — fine
      // for a 3-line PO, pathological for a 50-line one.
      const bomItemIds = [...new Set(po.items.map((l) => l.itemId))];
      const boms = await tx.bOM.findMany({
        where: {
          tenantId,
          productionItemId: { in: bomItemIds },
          isActive: true,
          isDefault: true,
        },
        select: { productionItemId: true },
      });
      const haveBom = new Set(boms.map((b) => b.productionItemId));
      for (const line of po.items) {
        if (!haveBom.has(line.itemId))
          throw new Error(
            `No default BOM for subcontracted item on line ${line.item.itemCode}`,
          );
      }
    }

    // C2: tally MR.orderedQty on any linked MRItems + flip MR to Ordered
    // (or Received if fully covered). The per-line update is intentionally
    // serial because each is a Decimal `increment` — concurrent writes
    // against the same MR item would race. The post-loop findMany is a
    // single query that replaces the previous per-line findUnique.
    const mrIds = new Set<string>();
    const linkedMrItemIds: string[] = [];
    for (const l of po.items) {
      if (!l.materialRequestItemId) continue;
      await tx.materialRequestItem.update({
        where: { id: l.materialRequestItemId },
        data: { orderedQty: { increment: new Prisma.Decimal(l.qty) } },
      });
      linkedMrItemIds.push(l.materialRequestItemId);
    }
    if (linkedMrItemIds.length > 0) {
      const mris = await tx.materialRequestItem.findMany({
        where: { id: { in: linkedMrItemIds } },
        select: { materialRequestId: true },
      });
      for (const mri of mris) mrIds.add(mri.materialRequestId);
    }
    for (const mrId of mrIds) {
      const items = await tx.materialRequestItem.findMany({
        where: { materialRequestId: mrId },
        select: { qty: true, orderedQty: true },
      });
      const allOrdered = items.every(
        (i) => Number(i.orderedQty) >= Number(i.qty) - 0.0001,
      );
      await tx.materialRequest.update({
        where: { id: mrId },
        data: { status: allOrdered ? "Received" : "Ordered" },
      });
    }
    return tx.purchaseOrder.update({
      where: { id: po.id },
      data: { status: "To Receive" },
    });
  });
  void publishRealtime(tenantId, "purchase-order", { id: result.id, status: "Submitted" });
  res.json(result);
});

// C10: subcontracting RM-transfer payload. Aggregates required RM across
// all lines using each FG's default BOM. UI POSTs the returned payload to
// stock-service `/stock-entries` as a Material Transfer.
purchaseOrderRouter.post("/:id/subcontract-transfer-payload", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const po = await prisma.purchaseOrder.findFirst({
    where: { id: req.params.id, tenantId },
    include: {
      items: {
        include: { item: { select: { isSubContractedItem: true, itemCode: true } } },
      },
    },
  });
  if (!po) return res.status(404).json({ error: "Not found" });
  if (!po.isSubcontracted)
    return res.status(400).json({ error: "PO is not subcontracted" });
  if (!po.supplierWarehouseId || !po.sourceWarehouseId)
    return res
      .status(400)
      .json({ error: "PO missing supplierWarehouseId or sourceWarehouseId" });
  const rmMap = new Map<string, number>();
  for (const line of po.items) {
    const bom = await prisma.bOM.findFirst({
      where: {
        tenantId,
        productionItemId: line.itemId,
        isActive: true,
        isDefault: true,
      },
      include: { items: true },
    });
    if (!bom)
      return res
        .status(400)
        .json({ error: `No default BOM for ${line.item.itemCode}` });
    const factor = Number(line.qty) / Number(bom.qty);
    for (const rm of bom.items) {
      rmMap.set(rm.itemId, (rmMap.get(rm.itemId) ?? 0) + Number(rm.qty) * factor);
    }
  }
  res.json({
    entryType: "Material Transfer",
    postingDate: new Date().toISOString(),
    remarks: `Subcontracting RM transfer for ${po.name}`,
    items: [...rmMap.entries()].map(([itemId, qty]) => ({
      itemId,
      qty,
      sourceWarehouseId: po.sourceWarehouseId,
      targetWarehouseId: po.supplierWarehouseId,
    })),
  });
});

// C1: PO → PR pre-fill. Since PR lives on stock-service, this endpoint just
// returns a payload the UI POSTs to stock-service/purchase-receipts. Keeps
// the cross-service boundary explicit + avoids service-to-service calls.
// Body: `{ warehouseId?, lineQtys?: {poItemId: number} }` — warehouseId
// applies to any line whose POItem has no warehouseId; lineQtys lets user
// receive < full remaining (defaults to remaining = qty − receivedQty).
purchaseOrderRouter.post("/:id/receive-payload", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const body = z
    .object({
      warehouseId: z.string().optional().nullable(),
      lineQtys: z.record(z.coerce.number().nonnegative()).optional(),
    })
    .safeParse(req.body ?? {});
  if (!body.success) return res.status(400).json({ error: body.error.flatten() });
  const po = await prisma.purchaseOrder.findFirst({
    where: { id: req.params.id, tenantId },
    include: {
      items: {
        include: {
          item: { select: { itemCode: true, itemName: true } },
          warehouse: { select: { id: true, warehouseName: true } },
        },
      },
    },
  });
  if (!po) return res.status(404).json({ error: "Not found" });
  if (po.status !== "To Receive")
    return res.status(400).json({
      error: `PO must be To Receive (current: ${po.status}) — submit the PO first`,
    });

  const lines = po.items
    .map((it) => {
      const remaining = Number(it.qty) - Number(it.receivedQty);
      if (remaining <= 0) return null;
      const requested = body.data.lineQtys?.[it.id];
      const qty = requested != null ? Math.min(requested, remaining) : remaining;
      if (qty <= 0) return null;
      const warehouseId = it.warehouseId ?? body.data.warehouseId ?? null;
      return {
        purchaseOrderItemId: it.id,
        itemId: it.itemId,
        warehouseId,
        qty,
        rate: Number(it.rate),
      };
    })
    .filter(
      (v): v is {
        purchaseOrderItemId: string;
        itemId: string;
        warehouseId: string | null;
        qty: number;
        rate: number;
      } => v !== null,
    );

  if (lines.length === 0)
    return res.status(400).json({ error: "Nothing left to receive on this PO" });
  const missingWh = lines.find((l) => !l.warehouseId);
  if (missingWh)
    return res.status(400).json({
      error:
        "One or more lines have no target warehouse — set per-line on the PO or pass `warehouseId` in the request body",
    });

  res.json({
    supplierId: po.supplierId,
    postingDate: new Date().toISOString(),
    remarks: `From ${po.name}`,
    items: lines,
  });
});

purchaseOrderRouter.post("/:id/cancel", p.cancel, idempotency("POST /purchase-orders/:id/cancel"), async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const result = await prisma.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.findFirst({
      where: { id: req.params.id, tenantId },
      include: { items: true },
    });
    if (!po) throw new Error("Not found");
    if (po.status === "Cancelled") throw new Error("Already cancelled");
    if (po.items.some((i) => Number(i.receivedQty) > 0))
      throw new Error("Cannot cancel — cancel linked Purchase Receipts first");
    // C2: decrement MR.orderedQty + roll status back to Submitted if this
    // PO had been the reason it was Ordered/Received.
    const mrIds = new Set<string>();
    for (const l of po.items) {
      if (!l.materialRequestItemId) continue;
      await tx.materialRequestItem.update({
        where: { id: l.materialRequestItemId },
        data: { orderedQty: { decrement: new Prisma.Decimal(l.qty) } },
      });
      const mri = await tx.materialRequestItem.findUnique({
        where: { id: l.materialRequestItemId },
        select: { materialRequestId: true },
      });
      if (mri) mrIds.add(mri.materialRequestId);
    }
    for (const mrId of mrIds) {
      const items = await tx.materialRequestItem.findMany({
        where: { materialRequestId: mrId },
        select: { orderedQty: true },
      });
      const anyOrdered = items.some((i) => Number(i.orderedQty) > 0);
      await tx.materialRequest.update({
        where: { id: mrId },
        data: { status: anyOrdered ? "Ordered" : "Submitted" },
      });
    }
    return tx.purchaseOrder.update({
      where: { id: po.id },
      data: { status: "Cancelled" },
    });
  });
  void publishRealtime(tenantId, "purchase-order", { id: result.id, status: "Cancelled" });
  res.json(result);
});
