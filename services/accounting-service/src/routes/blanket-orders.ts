import { Router } from "express";
import { z } from "zod";
import { Prisma, nextName, prisma } from "@lumaara/db";
import { idempotency, perms } from "@lumaara/service-auth";

// Module 50 — Blanket Order routes (selling + buying variants).
//
// Two create paths in one route (differentiated by blanketType).
// Downstream SO/PO would tally drawdown via a `blanketOrderItemId`
// backlink on their line rows — v1 leaves the drawdown update as a
// manual POST /:id/items/:lineId/draw endpoint; auto-drawdown on
// SO/PO submit is a follow-up.

export const blanketOrderRouter = Router();
const p = perms("PurchaseOrder");

const itemLineSchema = z.object({
  itemId: z.string().min(1),
  qty: z.coerce.number().positive(),
  rate: z.coerce.number().nonnegative(),
  description: z.string().max(500).optional().nullable(),
});

const upsertSchema = z
  .object({
    blanketType: z.enum(["Selling", "Buying"]),
    customerId: z.string().optional().nullable(),
    supplierId: z.string().optional().nullable(),
    validFrom: z.string().datetime(),
    validTill: z.string().datetime(),
    currency: z.string().default("INR"),
    remarks: z.string().max(500).optional().nullable(),
    items: z.array(itemLineSchema).min(1),
  })
  .refine((b) => (b.blanketType === "Selling" ? !!b.customerId : !!b.supplierId), {
    message: "Selling blankets need customerId; Buying blankets need supplierId",
  });

blanketOrderRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.blanketOrder.findMany({
    where: { tenantId: req.auth!.tenantId },
    include: {
      customer: { select: { customerName: true } },
      supplier: { select: { supplierName: true } },
      _count: { select: { items: true } },
    },
    orderBy: { validFrom: "desc" },
  });
  res.json(rows);
});

blanketOrderRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.blanketOrder.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      customer: true,
      supplier: true,
      items: { include: { item: { select: { itemCode: true, itemName: true } } } },
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

blanketOrderRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;
  const tenantId = req.auth!.tenantId;
  const validFrom = new Date(b.validFrom);
  const validTill = new Date(b.validTill);
  if (validTill < validFrom) {
    return res.status(400).json({ error: "validTill must be on or after validFrom" });
  }
  // Party check.
  if (b.customerId) {
    const c = await prisma.customer.count({ where: { id: b.customerId, tenantId } });
    if (!c) return res.status(400).json({ error: "Customer not found" });
  }
  if (b.supplierId) {
    const s = await prisma.supplier.count({ where: { id: b.supplierId, tenantId } });
    if (!s) return res.status(400).json({ error: "Supplier not found" });
  }
  // Items check.
  const itemIds = [...new Set(b.items.map((i) => i.itemId))];
  const found = await prisma.item.count({ where: { id: { in: itemIds }, tenantId } });
  if (found !== itemIds.length) {
    return res.status(400).json({ error: "One or more items not found" });
  }

  const name = await nextName(prisma, tenantId, "BO-");
  const row = await prisma.blanketOrder.create({
    data: {
      tenantId,
      name,
      blanketType: b.blanketType,
      customerId: b.customerId ?? null,
      supplierId: b.supplierId ?? null,
      validFrom,
      validTill,
      currency: b.currency,
      remarks: b.remarks ?? null,
      status: "Draft",
      items: {
        create: b.items.map((i) => ({
          itemId: i.itemId,
          qty: new Prisma.Decimal(i.qty),
          rate: new Prisma.Decimal(i.rate),
          description: i.description ?? null,
        })),
      },
    },
    include: { items: true },
  });
  res.status(201).json(row);
});

blanketOrderRouter.post("/:id/activate", p.submit, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const row = await prisma.blanketOrder.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  if (row.status !== "Draft") {
    return res.status(400).json({ error: `Cannot activate blanket in status ${row.status}` });
  }
  const updated = await prisma.blanketOrder.update({
    where: { id: row.id },
    data: { status: "Active" },
  });
  res.json(updated);
});

// Draw down a specific quantity against a blanket line. Called by
// SO/PO submit handlers when they detect a `blanketOrderItemId`
// backlink on their line rows. Also usable manually via curl for
// testing / adjustments.
const drawSchema = z.object({ qty: z.coerce.number().positive() });
blanketOrderRouter.post("/items/:lineId/draw", p.write, async (req, res) => {
  const parsed = drawSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;

  const line = await prisma.blanketOrderItem.findFirst({
    where: { id: req.params.lineId, blanketOrder: { tenantId } },
    include: { blanketOrder: { include: { items: true } } },
  });
  if (!line) return res.status(404).json({ error: "Line not found" });
  if (line.blanketOrder.status !== "Active") {
    return res.status(400).json({ error: `Blanket not active (status: ${line.blanketOrder.status})` });
  }
  // Decimal throughout — fractional qty (10.5 + 0.3) drifted with JS floats.
  const requestedQty = new Prisma.Decimal(parsed.data.qty);
  const remaining = new Prisma.Decimal(line.qty).sub(line.orderedQty);
  if (requestedQty.gt(remaining)) {
    return res.status(400).json({ error: `Only ${remaining.toString()} remaining on this line` });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const l = await tx.blanketOrderItem.update({
      where: { id: line.id },
      data: {
        orderedQty: new Prisma.Decimal(line.orderedQty).add(requestedQty),
      },
    });
    // Check if the whole blanket is now fulfilled.
    const allLines = await tx.blanketOrderItem.findMany({
      where: { blanketOrderId: line.blanketOrder.id },
      select: { qty: true, orderedQty: true },
    });
    const allDone = allLines.every((x) =>
      new Prisma.Decimal(x.orderedQty).gte(x.qty),
    );
    if (allDone) {
      await tx.blanketOrder.update({
        where: { id: line.blanketOrder.id },
        data: { status: "Completed" },
      });
    }
    return l;
  });
  res.json(updated);
});

blanketOrderRouter.post("/:id/cancel", p.cancel, idempotency("POST /blanket-orders/:id/cancel"), async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const row = await prisma.blanketOrder.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  if (row.status === "Cancelled" || row.status === "Completed") {
    return res.status(400).json({ error: `Cannot cancel ${row.status} blanket` });
  }
  const updated = await prisma.blanketOrder.update({
    where: { id: row.id },
    data: { status: "Cancelled" },
  });
  res.json(updated);
});
