import { Router } from "express";
import { z } from "zod";
import { Prisma, prisma, nextName } from "@lumaara/db";
import { idempotency, perms, publishRealtime } from "@lumaara/service-auth";

// C2: Material Request. Internal request for materials.
// Lifecycle: Draft → Submitted → Ordered → Received | Cancelled.

export const materialRequestRouter = Router();

const p = perms("MaterialRequest");

const itemLineSchema = z.object({
  itemId: z.string().min(1),
  qty: z.coerce.number().positive(),
  warehouseId: z.string().optional().nullable(),
  requiredDate: z.string().datetime().optional().nullable(),
  description: z.string().optional().nullable(),
});

const upsertSchema = z.object({
  materialRequestType: z
    .enum(["Purchase", "Material Transfer", "Material Issue", "Manufacture"])
    .default("Purchase"),
  transactionDate: z.string().datetime().optional(),
  requiredDate: z.string().datetime().optional().nullable(),
  remarks: z.string().optional().nullable(),
  items: z.array(itemLineSchema).min(1),
});

materialRequestRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.materialRequest.findMany({
    where: { tenantId: req.auth!.tenantId },
    include: { items: true },
    orderBy: { transactionDate: "desc" },
  });
  res.json(rows);
});

materialRequestRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.materialRequest.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      items: {
        include: {
          item: { select: { itemCode: true, itemName: true, stockUom: true } },
          warehouse: { select: { warehouseName: true } },
        },
      },
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

async function validateItemsAndWarehouses(
  tenantId: string,
  data: z.infer<typeof upsertSchema>,
): Promise<string | null> {
  const itemIds = data.items.map((i) => i.itemId);
  const validItems = await prisma.item.findMany({
    where: { id: { in: itemIds }, tenantId },
    select: { id: true },
  });
  if (validItems.length !== new Set(itemIds).size)
    return "One or more items are invalid for this tenant";
  const whIds = [
    ...new Set(data.items.map((i) => i.warehouseId).filter((v): v is string => !!v)),
  ];
  if (whIds.length > 0) {
    const whs = await prisma.warehouse.findMany({
      where: { id: { in: whIds }, tenantId, disabled: false, isGroup: false },
      select: { id: true },
    });
    if (whs.length !== whIds.length)
      return "One or more warehouses are invalid (must be leaf, non-disabled)";
  }
  return null;
}

materialRequestRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = parsed.data;
  const tenantId = req.auth!.tenantId;

  const err = await validateItemsAndWarehouses(tenantId, data);
  if (err) return res.status(400).json({ error: err });

  const name = await nextName(prisma, tenantId, "MR-");
  const row = await prisma.materialRequest.create({
    data: {
      tenantId,
      name,
      materialRequestType: data.materialRequestType,
      transactionDate: data.transactionDate ? new Date(data.transactionDate) : new Date(),
      requiredDate: data.requiredDate ? new Date(data.requiredDate) : null,
      remarks: data.remarks ?? null,
      status: "Draft",
      items: {
        create: data.items.map((i) => ({
          itemId: i.itemId,
          qty: new Prisma.Decimal(i.qty),
          warehouseId: i.warehouseId ?? null,
          requiredDate: i.requiredDate ? new Date(i.requiredDate) : null,
          description: i.description ?? null,
        })),
      },
    },
    include: { items: true },
  });
  res.status(201).json(row);
});

materialRequestRouter.put("/:id", p.write, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = parsed.data;
  const tenantId = req.auth!.tenantId;

  const existing = await prisma.materialRequest.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.status !== "Draft")
    return res.status(400).json({ error: `Cannot edit MR in status ${existing.status}` });

  const err = await validateItemsAndWarehouses(tenantId, data);
  if (err) return res.status(400).json({ error: err });

  const updated = await prisma.$transaction(async (tx) => {
    await tx.materialRequestItem.deleteMany({ where: { materialRequestId: existing.id } });
    return tx.materialRequest.update({
      where: { id: existing.id },
      data: {
        materialRequestType: data.materialRequestType,
        transactionDate: data.transactionDate
          ? new Date(data.transactionDate)
          : existing.transactionDate,
        requiredDate: data.requiredDate ? new Date(data.requiredDate) : null,
        remarks: data.remarks ?? null,
        items: {
          create: data.items.map((i) => ({
            itemId: i.itemId,
            qty: new Prisma.Decimal(i.qty),
            warehouseId: i.warehouseId ?? null,
            requiredDate: i.requiredDate ? new Date(i.requiredDate) : null,
            description: i.description ?? null,
          })),
        },
      },
      include: { items: true },
    });
  });
  res.json(updated);
});

materialRequestRouter.post("/:id/submit", p.submit, idempotency("POST /material-requests/:id/submit"), async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const mr = await prisma.materialRequest.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!mr) return res.status(404).json({ error: "Not found" });
  if (mr.status !== "Draft")
    return res.status(400).json({ error: `Cannot submit MR in status ${mr.status}` });
  const updated = await prisma.materialRequest.update({
    where: { id: mr.id },
    data: { status: "Submitted" },
  });
  void publishRealtime(tenantId, "material-request", { id: updated.id, status: "Submitted" });
  res.json(updated);
});

materialRequestRouter.post("/:id/cancel", p.cancel, idempotency("POST /material-requests/:id/cancel"), async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const mr = await prisma.materialRequest.findFirst({
    where: { id: req.params.id, tenantId },
    include: { items: true },
  });
  if (!mr) return res.status(404).json({ error: "Not found" });
  if (mr.status === "Cancelled") return res.status(400).json({ error: "Already cancelled" });
  if (mr.items.some((i) => Number(i.orderedQty) > 0))
    return res.status(400).json({
      error: "Cannot cancel — cancel linked Purchase Orders / Stock Entries first",
    });
  const updated = await prisma.materialRequest.update({
    where: { id: mr.id },
    data: { status: "Cancelled" },
  });
  void publishRealtime(tenantId, "material-request", { id: updated.id, status: "Cancelled" });
  res.json(updated);
});

// C2: MR → PO pre-fill (only for Purchase type). Returns a JSON payload the
// UI POSTs to accounting-service `/purchase-orders`. Line qtys default to
// (qty − orderedQty) so partial ordering works; `lineQtys` in the body can
// override per line.
materialRequestRouter.post("/:id/order-payload", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const body = z
    .object({
      supplierId: z.string().min(1),
      lineQtys: z.record(z.coerce.number().nonnegative()).optional(),
    })
    .safeParse(req.body ?? {});
  if (!body.success) return res.status(400).json({ error: body.error.flatten() });
  const mr = await prisma.materialRequest.findFirst({
    where: { id: req.params.id, tenantId },
    include: {
      items: {
        include: {
          item: { select: { standardRate: true } },
        },
      },
    },
  });
  if (!mr) return res.status(404).json({ error: "Not found" });
  if (mr.materialRequestType !== "Purchase")
    return res.status(400).json({
      error: `Only Purchase-type MRs convert to PO (this is ${mr.materialRequestType})`,
    });
  if (mr.status !== "Submitted" && mr.status !== "Ordered")
    return res.status(400).json({ error: `MR must be Submitted or Ordered (current: ${mr.status})` });

  const lines = mr.items
    .map((it) => {
      const remaining = Number(it.qty) - Number(it.orderedQty);
      if (remaining <= 0) return null;
      const requested = body.data.lineQtys?.[it.id];
      const qty = requested != null ? Math.min(requested, remaining) : remaining;
      if (qty <= 0) return null;
      return {
        materialRequestItemId: it.id,
        itemId: it.itemId,
        qty,
        rate: Number(it.item.standardRate),
        warehouseId: it.warehouseId,
      };
    })
    .filter(
      (v): v is {
        materialRequestItemId: string;
        itemId: string;
        qty: number;
        rate: number;
        warehouseId: string | null;
      } => v !== null,
    );
  if (lines.length === 0)
    return res.status(400).json({ error: "Nothing left to order on this MR" });

  res.json({
    supplierId: body.data.supplierId,
    transactionDate: new Date().toISOString(),
    remarks: `From ${mr.name}`,
    items: lines,
  });
});
