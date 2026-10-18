import { Router } from "express";
import { z } from "zod";
import {
  Prisma,
  cancelGLEntries,
  nextName,
  postGLEntries,
  prisma,
  requireTenantDefaults,
} from "@lumaara/db";
import { cancelStockEntries, postStockEntries } from "../lib/stock-posting";
import { idempotency, perms, publishRealtime } from "@lumaara/service-auth";

export const deliveryNoteRouter = Router();

const p = perms("DeliveryNote");

const itemLineSchema = z.object({
  itemId: z.string().min(1),
  warehouseId: z.string().min(1),
  qty: z.coerce.number().positive(),
  rate: z.coerce.number().nonnegative().default(0),
  // C5: serial numbers being shipped. For serialized items, length must
  // equal Math.floor(qty). Each number must be Active + currently at this
  // warehouse.
  serialNumbers: z.array(z.string().min(1)).optional(),
  // C6: batch to ship from. Required if item.hasBatchNo. Batch must exist
  // + have enough remaining qty.
  batchNo: z.string().optional().nullable(),
  // C7: transaction UOM + factor. Absent = qty is already in stock UOM.
  uom: z.string().optional().nullable(),
  conversionFactor: z.coerce.number().positive().optional().nullable(),
});

const createSchema = z.object({
  customerId: z.string().min(1),
  postingDate: z.string().datetime().optional(),
  remarks: z.string().optional().nullable(),
  items: z.array(itemLineSchema).min(1),
});

deliveryNoteRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.deliveryNote.findMany({
    where: { tenantId: req.auth!.tenantId },
    include: {
      customer: { select: { customerName: true } },
      items: {
        include: {
          item: { select: { itemCode: true, itemName: true } },
          warehouse: { select: { warehouseName: true } },
        },
      },
    },
    orderBy: { postingDate: "desc" },
  });
  res.json(rows);
});

deliveryNoteRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.deliveryNote.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      customer: true,
      items: { include: { item: true, warehouse: true } },
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

// Full detail: DN + items + GL entries (COGS / Stock-in-Hand) + SLE outflows
// posted by submit. All in one round trip.
deliveryNoteRouter.get("/:id/full", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;

  const dn = await prisma.deliveryNote.findFirst({
    where: { id: req.params.id, tenantId },
    include: {
      customer: true,
      items: { include: { item: true, warehouse: true } },
    },
  });
  if (!dn) return res.status(404).json({ error: "Not found" });

  const [glEntries, slEntries] = await Promise.all([
    prisma.gLEntry.findMany({
      where: {
        tenantId,
        voucherType: "DeliveryNote",
        voucherId: dn.id,
        isCancelled: false,
      },
      include: { account: { select: { accountName: true, rootType: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.stockLedgerEntry.findMany({
      where: {
        tenantId,
        voucherType: "DeliveryNote",
        voucherId: dn.id,
        isCancelled: false,
      },
      include: {
        item: { select: { itemCode: true, itemName: true, stockUom: true } },
        warehouse: { select: { warehouseName: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  res.json({ deliveryNote: dn, glEntries, slEntries });
});

// Update a Draft DN. Wipes items and recreates.
deliveryNoteRouter.put("/:id", p.write, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const p = parsed.data;
  const tenantId = req.auth!.tenantId;

  const existing = await prisma.deliveryNote.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.status !== "Draft")
    return res.status(400).json({ error: `Cannot edit DN in status ${existing.status}` });

  const customer = await prisma.customer.findFirst({
    where: { id: p.customerId, tenantId },
  });
  if (!customer) return res.status(400).json({ error: "Invalid customer" });

  const updated = await prisma.$transaction(async (tx) => {
    await tx.deliveryNoteItem.deleteMany({ where: { deliveryNoteId: existing.id } });
    return tx.deliveryNote.update({
      where: { id: existing.id },
      data: {
        customerId: p.customerId,
        postingDate: p.postingDate ? new Date(p.postingDate) : existing.postingDate,
        remarks: p.remarks ?? null,
        items: {
          create: p.items.map((i) => {
            const factor = i.conversionFactor ?? 1;
            return {
              itemId: i.itemId,
              warehouseId: i.warehouseId,
              qty: i.qty,
              rate: i.rate,
              serialNumbersInput: i.serialNumbers ?? [],
              batchNo: i.batchNo ?? null,
              uom: i.uom ?? null,
              conversionFactor: i.conversionFactor != null
                ? new Prisma.Decimal(i.conversionFactor)
                : null,
              stockQty: new Prisma.Decimal(i.qty * factor),
            };
          }),
        },
      },
      include: { items: true },
    });
  });
  res.json(updated);
});

deliveryNoteRouter.post("/", p.create, idempotency("POST /delivery-notes"), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const p = parsed.data;
  const tenantId = req.auth!.tenantId;

  const customer = await prisma.customer.findFirst({
    where: { id: p.customerId, tenantId },
  });
  if (!customer) return res.status(400).json({ error: "Invalid customer" });

  const name = await nextName(prisma, tenantId, "DN-");
  const row = await prisma.deliveryNote.create({
    data: {
      tenantId,
      name,
      customerId: p.customerId,
      postingDate: p.postingDate ? new Date(p.postingDate) : new Date(),
      remarks: p.remarks ?? null,
      status: "Draft",
      items: {
        create: p.items.map((i) => ({
          itemId: i.itemId,
          warehouseId: i.warehouseId,
          qty: i.qty,
          rate: i.rate,
        })),
      },
    },
    include: { items: true },
  });
  res.status(201).json(row);
});

// Submit: consume stock at current avg rate + post COGS/Stock-in-Hand GL entry.
deliveryNoteRouter.post("/:id/submit", p.submit, idempotency("POST /delivery-notes/:id/submit"), async (req, res) => {
  const tenantId = req.auth!.tenantId;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const dn = await tx.deliveryNote.findFirst({
        where: { id: req.params.id, tenantId },
        include: {
          items: {
            include: {
              item: {
                select: {
                  hasSerialNo: true,
                  hasBatchNo: true,
                  inspectionRequiredBeforeDelivery: true,
                  itemCode: true,
                },
              },
              qualityInspections: { select: { overallStatus: true } },
            },
          },
        },
      });
      if (!dn) throw new Error("Not found");

      // C9: refuse submit if any line's item requires QI-before-delivery.
      for (const l of dn.items) {
        if (!l.item.inspectionRequiredBeforeDelivery) continue;
        const accepted = l.qualityInspections.some(
          (q) => q.overallStatus === "Accepted",
        );
        if (!accepted)
          throw new Error(
            `${l.item.itemCode}: quality inspection required before delivery (create + accept a QI for this DN line)`,
          );
      }
      if (!dn) throw new Error("Not found");
      if (dn.status !== "Draft") throw new Error(`Cannot submit in status ${dn.status}`);

      // C5: validate every serial number before doing any writes.
      const allSerials: string[] = [];
      for (const l of dn.items) {
        if (!l.item.hasSerialNo) {
          if (l.serialNumbersInput.length > 0)
            throw new Error(
              `${l.item.itemCode}: serial numbers provided for a non-serialized item`,
            );
          continue;
        }
        const need = Math.floor(Number(l.qty));
        if (l.serialNumbersInput.length !== need)
          throw new Error(
            `${l.item.itemCode}: need ${need} serial numbers, got ${l.serialNumbersInput.length}`,
          );
        for (const s of l.serialNumbersInput) allSerials.push(s);
      }
      // C6: batch validation — required if item.hasBatchNo, and batch must
      // have enough remaining (in stock UOM per C7).
      const batchDemand = new Map<string, number>();
      for (const l of dn.items) {
        if (l.item.hasBatchNo && !l.batchNo)
          throw new Error(`${l.item.itemCode}: batch number required`);
        if (!l.item.hasBatchNo && l.batchNo)
          throw new Error(
            `${l.item.itemCode}: batch given but item is not batch-tracked`,
          );
        if (l.batchNo) {
          const key = `${l.itemId}::${l.batchNo}`;
          const bq = l.stockQty != null ? Number(l.stockQty) : Number(l.qty);
          batchDemand.set(key, (batchDemand.get(key) ?? 0) + bq);
        }
      }
      for (const [key, need] of batchDemand) {
        const [itemId, batchNo] = key.split("::");
        const b = await tx.batch.findUnique({
          where: {
            tenantId_itemId_batchNo: { tenantId, itemId, batchNo },
          },
        });
        if (!b) throw new Error(`Batch ${batchNo} not found for item`);
        if (Number(b.batchQty) < need - 0.0001)
          throw new Error(
            `Batch ${batchNo}: have ${Number(b.batchQty).toFixed(2)}, need ${need.toFixed(2)}`,
          );
      }

      if (allSerials.length > 0) {
        const found = await tx.serialNo.findMany({
          where: { tenantId, serialNo: { in: allSerials } },
        });
        const foundMap = new Map(found.map((f) => [f.serialNo, f]));
        for (const l of dn.items) {
          if (!l.item.hasSerialNo) continue;
          for (const s of l.serialNumbersInput) {
            const sn = foundMap.get(s);
            if (!sn)
              throw new Error(`Serial ${s} not found in stock`);
            if (sn.status !== "Active")
              throw new Error(
                `Serial ${s} is ${sn.status} — must be Active to ship`,
              );
            if (sn.warehouseId !== l.warehouseId)
              throw new Error(
                `Serial ${s} is not in the source warehouse for this line`,
              );
            if (sn.itemId !== l.itemId)
              throw new Error(
                `Serial ${s} belongs to a different item than line ${l.item.itemCode}`,
              );
          }
        }
      }

      const defaults = await requireTenantDefaults(tx, tenantId, [
        "defaultCogsAccountId",
        "defaultStockInHandAccountId",
      ]);

      // Compute total stock value consumed BEFORE posting SLEs. For outflows,
      // moving-avg rate doesn't change, so reading rate up-front is safe even
      // if multiple lines hit the same (item, warehouse).
      // C7: quantities are always in stock UOM for bin math.
      let totalConsumed = 0;
      for (const line of dn.items) {
        const bin = await tx.bin.findUnique({
          where: {
            tenantId_itemId_warehouseId: {
              tenantId,
              itemId: line.itemId,
              warehouseId: line.warehouseId,
            },
          },
          select: { valuationRate: true, actualQty: true },
        });
        const rate = Number(bin?.valuationRate ?? 0);
        const stockQty = line.stockQty != null ? Number(line.stockQty) : Number(line.qty);
        totalConsumed += stockQty * rate;
      }

      await postStockEntries(tx, {
        tenantId,
        postingDate: dn.postingDate,
        voucherType: "DeliveryNote",
        voucherId: dn.id,
        voucherName: dn.name,
        lines: dn.items.map((l) => {
          const stockQty = l.stockQty != null ? Number(l.stockQty) : Number(l.qty);
          return {
            itemId: l.itemId,
            warehouseId: l.warehouseId,
            actualQty: -stockQty,
          };
        }),
      });

      if (totalConsumed > 0) {
        await postGLEntries(tx, {
          tenantId,
          postingDate: dn.postingDate,
          voucherType: "DeliveryNote",
          voucherId: dn.id,
          voucherName: dn.name,
          lines: [
            { accountId: defaults.defaultCogsAccountId!, debit: totalConsumed, credit: 0 },
            {
              accountId: defaults.defaultStockInHandAccountId!,
              debit: 0,
              credit: totalConsumed,
            },
          ],
        });
      }

      // C5: flip each shipped serial to Delivered + link to this DNItem.
      for (const l of dn.items) {
        if (!l.item.hasSerialNo || l.serialNumbersInput.length === 0) continue;
        await tx.serialNo.updateMany({
          where: { tenantId, serialNo: { in: l.serialNumbersInput } },
          data: {
            status: "Delivered",
            warehouseId: null,
            deliveryNoteItemId: l.id,
          },
        });
      }

      // C6 + C7: decrement Batch.batchQty in stock UOM for each shipped batch.
      for (const l of dn.items) {
        if (!l.batchNo) continue;
        const bq = l.stockQty ?? l.qty;
        await tx.batch.update({
          where: {
            tenantId_itemId_batchNo: {
              tenantId,
              itemId: l.itemId,
              batchNo: l.batchNo,
            },
          },
          data: { batchQty: { decrement: bq } },
        });
      }

      return tx.deliveryNote.update({
        where: { id: dn.id },
        data: { status: "Submitted" },
        include: { items: true },
      });
    });
    void publishRealtime(tenantId, "delivery-note", { id: result.id, status: "Submitted" });
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(msg === "Not found" ? 404 : 400).json({ error: msg });
  }
});

deliveryNoteRouter.post("/:id/cancel", p.cancel, idempotency("POST /delivery-notes/:id/cancel"), async (req, res) => {
  const tenantId = req.auth!.tenantId;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const dn = await tx.deliveryNote.findFirst({
        where: { id: req.params.id, tenantId },
        include: { items: true },
      });
      if (!dn) throw new Error("Not found");
      if (dn.status === "Cancelled") throw new Error("Already cancelled");

      if (dn.status === "Submitted") {
        await cancelStockEntries(tx, {
          tenantId,
          voucherType: "DeliveryNote",
          voucherId: dn.id,
        });
        await cancelGLEntries(tx, {
          tenantId,
          voucherType: "DeliveryNote",
          voucherId: dn.id,
        });
        // C5: return each Delivered serial to Active at its original warehouse.
        for (const l of dn.items) {
          const serials = await tx.serialNo.findMany({
            where: { tenantId, deliveryNoteItemId: l.id },
            select: { id: true },
          });
          if (serials.length === 0) continue;
          await tx.serialNo.updateMany({
            where: { id: { in: serials.map((s) => s.id) } },
            data: {
              status: "Active",
              warehouseId: l.warehouseId,
              deliveryNoteItemId: null,
            },
          });
        }

        // C6 + C7: restore batch qty in stock UOM.
        for (const l of dn.items) {
          if (!l.batchNo) continue;
          const bq = l.stockQty ?? l.qty;
          await tx.batch.update({
            where: {
              tenantId_itemId_batchNo: {
                tenantId,
                itemId: l.itemId,
                batchNo: l.batchNo,
              },
            },
            data: { batchQty: { increment: bq } },
          });
        }
      }

      return tx.deliveryNote.update({
        where: { id: dn.id },
        data: { status: "Cancelled" },
      });
    });
    void publishRealtime(tenantId, "delivery-note", { id: result.id, status: "Cancelled" });
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(msg === "Not found" ? 404 : 400).json({ error: msg });
  }
});
