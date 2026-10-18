import { Router } from "express";
import { z } from "zod";
import {
  Prisma,
  findActiveConflicts,
  nextName,
  pickProgress,
  prisma,
  sortForPickWalk,
} from "@lumaara/db";
import { idempotency, perms, publishRealtime } from "@lumaara/service-auth";

// Module 47 — Pick List routes.
//
// Two create paths:
//   POST /pick-lists                    — explicit lines (advanced)
//   POST /pick-lists/aggregate-from-dns — hand a list of DN IDs and
//                                          the route pulls every line
//                                          from those DNs, sorts them
//                                          into a walk order, and
//                                          creates the PickList.
//
// Runtime workflow:
//   Submit  — freezes the PickList, guards against double-booking DN
//             lines already on another active list.
//   Mark    — POST /:id/mark-picked with per-row picked qty. When
//             every row is fully picked, status auto-flips to
//             Completed.
//   Cancel  — releases all DN lines back to the free pool.

export const pickListRouter = Router();
const p = perms("DeliveryNote"); // reuse DN perm surface

const lineSchema = z.object({
  deliveryNoteItemId: z.string().min(1),
});

const createSchema = z.object({
  purpose: z.enum(["Delivery", "Material Transfer", "Manufacture"]).default("Delivery"),
  pickedBy: z.string().max(200).optional().nullable(),
  remarks: z.string().max(500).optional().nullable(),
  postingDate: z.string().datetime().optional(),
  lines: z.array(lineSchema).min(1),
});

const aggregateSchema = z.object({
  purpose: z.enum(["Delivery", "Material Transfer", "Manufacture"]).default("Delivery"),
  pickedBy: z.string().max(200).optional().nullable(),
  deliveryNoteIds: z.array(z.string()).min(1),
});

pickListRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.pickList.findMany({
    where: { tenantId: req.auth!.tenantId },
    include: { _count: { select: { items: true } } },
    orderBy: { postingDate: "desc" },
  });
  res.json(rows);
});

pickListRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.pickList.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      items: {
        include: {
          item: { select: { itemCode: true, itemName: true } },
          warehouse: { select: { warehouseName: true } },
          deliveryNoteItem: {
            include: {
              deliveryNote: { select: { name: true, customer: { select: { customerName: true } } } },
            },
          },
        },
      },
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

// Aggregate: take a list of DN IDs, pull every DN item line, sort into
// a walk order, and create the PickList. Handles the common case where
// the operator picks a set of DNs in the UI and hits "Create Pick List".
pickListRouter.post("/aggregate-from-dns", p.create, async (req, res) => {
  const parsed = aggregateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;
  const tenantId = req.auth!.tenantId;

  // Validate all DNs belong to tenant, and are in a picky-able state
  // (Draft or Submitted — Cancelled DNs shouldn't be picked).
  const dns = await prisma.deliveryNote.findMany({
    where: {
      id: { in: b.deliveryNoteIds },
      tenantId,
      status: { in: ["Draft", "Submitted"] },
    },
    include: {
      items: {
        include: { warehouse: { select: { warehouseName: true } } },
      },
    },
  });
  if (dns.length !== new Set(b.deliveryNoteIds).size) {
    return res.status(400).json({
      error: "One or more delivery notes are not found or are cancelled",
    });
  }

  const rawLines = dns.flatMap((dn) =>
    dn.items.map((i) => ({
      deliveryNoteItemId: i.id,
      itemId: i.itemId,
      warehouseId: i.warehouseId,
      warehouseName: i.warehouse.warehouseName,
      qty: Number(i.qty),
      batchNo: i.batchNo,
      serialNos: i.serialNumbersInput,
    })),
  );
  if (rawLines.length === 0) {
    return res.status(400).json({ error: "No line items across the selected delivery notes" });
  }
  const sorted = sortForPickWalk(rawLines);

  const name = await nextName(prisma, tenantId, "PICK-");
  const row = await prisma.pickList.create({
    data: {
      tenantId,
      name,
      purpose: b.purpose,
      pickedBy: b.pickedBy ?? null,
      status: "Draft",
      items: {
        create: sorted.map((l) => ({
          deliveryNoteItemId: l.deliveryNoteItemId,
          itemId: l.itemId,
          warehouseId: l.warehouseId,
          qty: new Prisma.Decimal(l.qty),
          batchNo: l.batchNo,
          serialNos: l.serialNos,
        })),
      },
    },
    include: { items: true },
  });
  res.status(201).json(row);
});

pickListRouter.post("/", p.create, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;
  const tenantId = req.auth!.tenantId;

  // Fetch the DN lines the caller wants + verify tenant ownership.
  const dnLineIds = b.lines.map((l) => l.deliveryNoteItemId);
  const dnLines = await prisma.deliveryNoteItem.findMany({
    where: {
      id: { in: dnLineIds },
      deliveryNote: { tenantId },
    },
    include: {
      warehouse: { select: { warehouseName: true } },
    },
  });
  if (dnLines.length !== new Set(dnLineIds).size) {
    return res.status(400).json({ error: "One or more DN lines invalid or off-tenant" });
  }

  const rawLines = dnLines.map((l) => ({
    deliveryNoteItemId: l.id,
    itemId: l.itemId,
    warehouseId: l.warehouseId,
    warehouseName: l.warehouse.warehouseName,
    qty: Number(l.qty),
    batchNo: l.batchNo,
    serialNos: l.serialNumbersInput,
  }));
  const sorted = sortForPickWalk(rawLines);

  const name = await nextName(prisma, tenantId, "PICK-");
  const row = await prisma.pickList.create({
    data: {
      tenantId,
      name,
      purpose: b.purpose,
      postingDate: b.postingDate ? new Date(b.postingDate) : new Date(),
      pickedBy: b.pickedBy ?? null,
      remarks: b.remarks ?? null,
      status: "Draft",
      items: {
        create: sorted.map((l) => ({
          deliveryNoteItemId: l.deliveryNoteItemId,
          itemId: l.itemId,
          warehouseId: l.warehouseId,
          qty: new Prisma.Decimal(l.qty),
          batchNo: l.batchNo,
          serialNos: l.serialNos,
        })),
      },
    },
    include: { items: true },
  });
  res.status(201).json(row);
});

pickListRouter.post("/:id/submit", p.submit, idempotency("POST /pick-lists/:id/submit"), async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const row = await prisma.pickList.findFirst({
    where: { id: req.params.id, tenantId },
    include: { items: { select: { id: true, deliveryNoteItemId: true } } },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  if (row.status !== "Draft") {
    return res.status(400).json({ error: `Cannot submit pick list in status ${row.status}` });
  }

  // Guard: no DN line may appear on more than one active PickList.
  const dnLineIds = row.items.map((i) => i.deliveryNoteItemId);
  const activeElsewhere = await prisma.pickListItem.findMany({
    where: {
      deliveryNoteItemId: { in: dnLineIds },
      pickList: {
        tenantId,
        status: { in: ["Submitted"] },
        NOT: { id: row.id },
      },
    },
    include: {
      pickList: { select: { name: true, status: true } },
    },
  });
  const conflicts = findActiveConflicts(dnLineIds, activeElsewhere);
  if (conflicts.length > 0) {
    return res.status(400).json({
      error: `Conflict: ${conflicts.length} DN line(s) already on ${conflicts[0].existingPickListName}. Cancel the other pick list first.`,
      conflicts,
    });
  }

  const updated = await prisma.pickList.update({
    where: { id: row.id },
    data: { status: "Submitted" },
  });
  void publishRealtime(tenantId, "pick-list", { id: updated.id, status: "Submitted" });
  res.json(updated);
});

// Update picked quantities. Payload lets the worker/scanner tick off
// each row's picked qty; when every row's pickedQty >= qty the list
// auto-flips to Completed.
const markSchema = z.object({
  picks: z
    .array(
      z.object({
        pickListItemId: z.string(),
        pickedQty: z.coerce.number().nonnegative(),
      }),
    )
    .min(1),
});
pickListRouter.post("/:id/mark-picked", p.write, async (req, res) => {
  const parsed = markSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;

  const row = await prisma.pickList.findFirst({
    where: { id: req.params.id, tenantId },
    include: { items: true },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  if (row.status !== "Submitted") {
    return res.status(400).json({ error: `Cannot mark picks on list in status ${row.status}` });
  }

  const byId = new Map(row.items.map((i) => [i.id, i]));
  for (const p of parsed.data.picks) {
    if (!byId.has(p.pickListItemId)) {
      return res.status(400).json({ error: `PickListItem ${p.pickListItemId} not on this list` });
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    for (const p of parsed.data.picks) {
      await tx.pickListItem.update({
        where: { id: p.pickListItemId },
        data: { pickedQty: new Prisma.Decimal(p.pickedQty) },
      });
    }
    const refreshed = await tx.pickListItem.findMany({
      where: { pickListId: row.id },
      select: { qty: true, pickedQty: true },
    });
    const progress = pickProgress(
      refreshed.map((r) => ({ qty: Number(r.qty), pickedQty: Number(r.pickedQty) })),
    );
    if (progress >= 1) {
      return tx.pickList.update({
        where: { id: row.id },
        data: { status: "Completed" },
      });
    }
    return tx.pickList.findFirst({ where: { id: row.id } });
  });
  if (result?.status === "Completed") {
    void publishRealtime(tenantId, "pick-list", { id: result.id, status: "Completed" });
  }
  res.json(result);
});

pickListRouter.post("/:id/cancel", p.cancel, idempotency("POST /pick-lists/:id/cancel"), async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const row = await prisma.pickList.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  if (row.status === "Cancelled") return res.status(400).json({ error: "Already cancelled" });
  const updated = await prisma.pickList.update({
    where: { id: row.id },
    data: { status: "Cancelled" },
  });
  void publishRealtime(tenantId, "pick-list", { id: updated.id, status: "Cancelled" });
  res.json(updated);
});
