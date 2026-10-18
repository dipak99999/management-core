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

export const purchaseReceiptRouter = Router();

const p = perms("PurchaseReceipt");

const itemLineSchema = z.object({
  itemId: z.string().min(1),
  warehouseId: z.string().min(1),
  qty: z.coerce.number().positive(),
  rate: z.coerce.number().nonnegative().default(0), // valuation input
  // C1: back-link to a PurchaseOrderItem so PR submit auto-tallies the PO's
  // receivedQty (and PO status flips to Completed when fully received).
  purchaseOrderItemId: z.string().optional().nullable(),
  // C5: for serialized items, one serial per unit. Length must equal Math.floor(qty).
  serialNumbers: z.array(z.string().min(1)).optional(),
  // C6: for batch-tracked items, batchNo is required; manufacture/expiry
  // are optional (only for items with hasExpiryDate). If the batch is new,
  // Batch row is created on submit.
  batchNo: z.string().optional().nullable(),
  manufactureDate: z.string().datetime().optional().nullable(),
  expiryDate: z.string().datetime().optional().nullable(),
  // C7: transaction UOM + factor. When absent, qty is in stock UOM.
  uom: z.string().optional().nullable(),
  conversionFactor: z.coerce.number().positive().optional().nullable(),
});

const createSchema = z.object({
  supplierId: z.string().min(1),
  supplierDeliveryNo: z.string().optional().nullable(),
  postingDate: z.string().datetime().optional(),
  remarks: z.string().optional().nullable(),
  items: z.array(itemLineSchema).min(1),
});

purchaseReceiptRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.purchaseReceipt.findMany({
    where: { tenantId: req.auth!.tenantId },
    include: {
      supplier: { select: { supplierName: true } },
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

purchaseReceiptRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.purchaseReceipt.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      supplier: true,
      items: { include: { item: true, warehouse: true } },
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

// Full detail: PR + items + GL entries (Stock-in-Hand / SRBNB) + SLE inflows.
purchaseReceiptRouter.get("/:id/full", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;

  const pr = await prisma.purchaseReceipt.findFirst({
    where: { id: req.params.id, tenantId },
    include: {
      supplier: true,
      items: { include: { item: true, warehouse: true } },
    },
  });
  if (!pr) return res.status(404).json({ error: "Not found" });

  const [glEntries, slEntries] = await Promise.all([
    prisma.gLEntry.findMany({
      where: {
        tenantId,
        voucherType: "PurchaseReceipt",
        voucherId: pr.id,
        isCancelled: false,
      },
      include: { account: { select: { accountName: true, rootType: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.stockLedgerEntry.findMany({
      where: {
        tenantId,
        voucherType: "PurchaseReceipt",
        voucherId: pr.id,
        isCancelled: false,
      },
      include: {
        item: { select: { itemCode: true, itemName: true, stockUom: true } },
        warehouse: { select: { warehouseName: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  res.json({ purchaseReceipt: pr, glEntries, slEntries });
});

// Update a Draft PR. Wipes items and recreates.
purchaseReceiptRouter.put("/:id", p.write, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const p = parsed.data;
  const tenantId = req.auth!.tenantId;

  const existing = await prisma.purchaseReceipt.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.status !== "Draft")
    return res.status(400).json({ error: `Cannot edit PR in status ${existing.status}` });

  const supplier = await prisma.supplier.findFirst({
    where: { id: p.supplierId, tenantId },
  });
  if (!supplier) return res.status(400).json({ error: "Invalid supplier" });

  const updated = await prisma.$transaction(async (tx) => {
    await tx.purchaseReceiptItem.deleteMany({ where: { purchaseReceiptId: existing.id } });
    return tx.purchaseReceipt.update({
      where: { id: existing.id },
      data: {
        supplierId: p.supplierId,
        supplierDeliveryNo: p.supplierDeliveryNo ?? null,
        postingDate: p.postingDate ? new Date(p.postingDate) : existing.postingDate,
        remarks: p.remarks ?? null,
        items: {
          create: p.items.map((i) => {
            const factor = i.conversionFactor ?? 1;
            const stockQty = i.qty * factor;
            return {
              itemId: i.itemId,
              warehouseId: i.warehouseId,
              qty: i.qty,
              rate: i.rate,
              purchaseOrderItemId: i.purchaseOrderItemId ?? null,
              serialNumbersInput: i.serialNumbers ?? [],
              batchNo: i.batchNo ?? null,
              manufactureDate: i.manufactureDate ? new Date(i.manufactureDate) : null,
              expiryDate: i.expiryDate ? new Date(i.expiryDate) : null,
              uom: i.uom ?? null,
              conversionFactor: i.conversionFactor != null
                ? new Prisma.Decimal(i.conversionFactor)
                : null,
              stockQty: new Prisma.Decimal(stockQty),
            };
          }),
        },
      },
      include: { items: true },
    });
  });
  res.json(updated);
});

purchaseReceiptRouter.post("/", p.create, idempotency("POST /purchase-receipts"), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const p = parsed.data;
  const tenantId = req.auth!.tenantId;

  const supplier = await prisma.supplier.findFirst({
    where: { id: p.supplierId, tenantId },
  });
  if (!supplier) return res.status(400).json({ error: "Invalid supplier" });

  const name = await nextName(prisma, tenantId, "PR-");
  const row = await prisma.purchaseReceipt.create({
    data: {
      tenantId,
      name,
      supplierId: p.supplierId,
      supplierDeliveryNo: p.supplierDeliveryNo ?? null,
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

// Submit: receive stock (moving-avg incoming) + post Stock/SRBNB GL entry.
purchaseReceiptRouter.post("/:id/submit", p.submit, idempotency("POST /purchase-receipts/:id/submit"), async (req, res) => {
  const tenantId = req.auth!.tenantId;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const pr = await tx.purchaseReceipt.findFirst({
        where: { id: req.params.id, tenantId },
        include: {
          items: {
            include: {
              item: {
                select: {
                  hasSerialNo: true,
                  hasBatchNo: true,
                  hasExpiryDate: true,
                  inspectionRequiredBeforeReceipt: true,
                  itemCode: true,
                },
              },
              qualityInspections: { select: { overallStatus: true } },
            },
          },
        },
      });
      if (!pr) throw new Error("Not found");
      if (pr.status !== "Draft") throw new Error(`Cannot submit in status ${pr.status}`);

      // C5: validate serials before any writes. For serialized items,
      // serialNumbersInput length must equal Math.floor(qty), and each
      // number must be unique both within this PR and against existing
      // Active/Delivered SerialNos in the tenant.
      const allSerials: string[] = [];
      for (const l of pr.items) {
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
        for (const s of l.serialNumbersInput) {
          if (allSerials.includes(s))
            throw new Error(`Duplicate serial number in this PR: ${s}`);
          allSerials.push(s);
        }
      }
      if (allSerials.length > 0) {
        const existing = await tx.serialNo.findMany({
          where: {
            tenantId,
            serialNo: { in: allSerials },
            status: { in: ["Active", "Delivered"] },
          },
          select: { serialNo: true },
        });
        if (existing.length > 0)
          throw new Error(
            `Serial numbers already exist: ${existing.map((e) => e.serialNo).join(", ")}`,
          );
      }

      // C9: refuse submit if any line's item requires QI-before-receipt and
      // doesn't have an Accepted QualityInspection linked to that line.
      for (const l of pr.items) {
        if (!l.item.inspectionRequiredBeforeReceipt) continue;
        const accepted = l.qualityInspections.some(
          (q) => q.overallStatus === "Accepted",
        );
        if (!accepted)
          throw new Error(
            `${l.item.itemCode}: quality inspection required before receipt (create + accept a QI for this PR line)`,
          );
      }

      // C6: validate batch requirement — batch-tracked items must have batchNo.
      for (const l of pr.items) {
        if (l.item.hasBatchNo && !l.batchNo)
          throw new Error(`${l.item.itemCode}: batch number required`);
        if (!l.item.hasBatchNo && l.batchNo)
          throw new Error(
            `${l.item.itemCode}: batch number given but item is not batch-tracked`,
          );
      }

      const defaults = await requireTenantDefaults(tx, tenantId, [
        "defaultStockInHandAccountId",
        "defaultStockReceivedButNotBilledAccountId",
      ]);

      // Total received is invariant to UOM: qty × rate = stockQty × (rate/factor).
      const totalReceived = pr.items.reduce(
        (s, l) => s + Number(l.qty) * Number(l.rate),
        0,
      );

      // Subcontracting: PR against a subcontracted PO consumes RM from
      // the PO's supplierWarehouseId (where the PO originally staged
      // the RM) and rolls that RM value into the FG's incoming rate on
      // top of the supplier's bill (which pays for labor + overhead).
      //
      // We collect { poLineId → { supplierWarehouseId, rmAdditionalRate,
      // rmDeductions[] } } up-front so each FG line can compute its
      // effective incomingRate + emit the paired RM deductions inside
      // the same postStockEntries call.
      const poLineIdsForSubcontract = pr.items
        .map((l) => l.purchaseOrderItemId)
        .filter((id): id is string => !!id);
      const poLines = poLineIdsForSubcontract.length
        ? await tx.purchaseOrderItem.findMany({
            where: { id: { in: poLineIdsForSubcontract } },
            include: {
              purchaseOrder: {
                select: { isSubcontracted: true, supplierWarehouseId: true },
              },
            },
          })
        : [];

      // For each subcontract FG line, look up its default BOM once so we
      // know per-unit RM requirement. Batched to one query per unique FG.
      const subcontractFgItemIds = Array.from(
        new Set(
          pr.items
            .filter((l) => {
              const po = poLines.find((p) => p.id === l.purchaseOrderItemId);
              return po?.purchaseOrder.isSubcontracted && po?.purchaseOrder.supplierWarehouseId;
            })
            .map((l) => l.itemId),
        ),
      );
      const bomsByFgItem = subcontractFgItemIds.length
        ? await tx.bOM.findMany({
            where: { tenantId, productionItemId: { in: subcontractFgItemIds }, isDefault: true },
            include: { items: true },
          })
        : [];

      // Snapshot RM valuation rates from the supplier warehouse bins,
      // batched to one findMany over the full RM×warehouse cross-product.
      const supplierBinKeys: Array<{ itemId: string; warehouseId: string }> = [];
      for (const l of pr.items) {
        const po = poLines.find((p) => p.id === l.purchaseOrderItemId);
        if (!po?.purchaseOrder.isSubcontracted || !po.purchaseOrder.supplierWarehouseId) continue;
        const bom = bomsByFgItem.find((b) => b.productionItemId === l.itemId);
        if (!bom) continue;
        for (const bi of bom.items) {
          supplierBinKeys.push({
            itemId: bi.itemId,
            warehouseId: po.purchaseOrder.supplierWarehouseId,
          });
        }
      }
      const rmRateByKey = new Map<string, number>();
      if (supplierBinKeys.length > 0) {
        const bins = await tx.bin.findMany({
          where: {
            tenantId,
            OR: supplierBinKeys.map((k) => ({ itemId: k.itemId, warehouseId: k.warehouseId })),
          },
          select: { itemId: true, warehouseId: true, valuationRate: true },
        });
        for (const b of bins) {
          rmRateByKey.set(`${b.itemId}::${b.warehouseId}`, Number(b.valuationRate));
        }
      }

      const stockLines: Array<{
        itemId: string;
        warehouseId: string;
        actualQty: number;
        incomingRate?: number;
      }> = [];
      for (const l of pr.items) {
        const factor = l.conversionFactor != null ? Number(l.conversionFactor) : 1;
        const stockQty = l.stockQty != null ? Number(l.stockQty) : Number(l.qty);
        const supplierRate = Number(l.rate) / factor;
        const po = poLines.find((p) => p.id === l.purchaseOrderItemId);
        const isSub = po?.purchaseOrder.isSubcontracted && po?.purchaseOrder.supplierWarehouseId;
        if (!isSub) {
          stockLines.push({
            itemId: l.itemId,
            warehouseId: l.warehouseId,
            actualQty: stockQty,
            incomingRate: supplierRate,
          });
          continue;
        }
        const bom = bomsByFgItem.find((b) => b.productionItemId === l.itemId);
        if (!bom) {
          throw new Error(
            `Subcontract PR line ${l.item.itemCode}: FG has no default BOM. Set one on the item or on the PO.`,
          );
        }
        // BOM.qty is the FG qty the RM row is scaled to (usually 1).
        const bomFgQty = Number(bom.qty) || 1;
        let rmValuePerFgUnit = 0;
        for (const bi of bom.items) {
          const rmPerUnit = Number(bi.qty) / bomFgQty;
          const rmTotal = rmPerUnit * stockQty;
          const rate = rmRateByKey.get(`${bi.itemId}::${po.purchaseOrder.supplierWarehouseId}`) ?? 0;
          rmValuePerFgUnit += rmPerUnit * rate;
          stockLines.push({
            itemId: bi.itemId,
            warehouseId: po.purchaseOrder.supplierWarehouseId!,
            actualQty: -rmTotal,
          });
        }
        stockLines.push({
          itemId: l.itemId,
          warehouseId: l.warehouseId,
          actualQty: stockQty,
          incomingRate: supplierRate + rmValuePerFgUnit,
        });
      }

      await postStockEntries(tx, {
        tenantId,
        postingDate: pr.postingDate,
        voucherType: "PurchaseReceipt",
        voucherId: pr.id,
        voucherName: pr.name,
        lines: stockLines,
      });

      if (totalReceived > 0) {
        await postGLEntries(tx, {
          tenantId,
          postingDate: pr.postingDate,
          voucherType: "PurchaseReceipt",
          voucherId: pr.id,
          voucherName: pr.name,
          lines: [
            {
              accountId: defaults.defaultStockInHandAccountId!,
              debit: totalReceived,
              credit: 0,
            },
            {
              accountId: defaults.defaultStockReceivedButNotBilledAccountId!,
              debit: 0,
              credit: totalReceived,
              partyType: "Supplier",
              partyId: pr.supplierId,
            },
          ],
        });
      }

      // C5: create SerialNo rows for each serialized line, Active at the
      // receiving warehouse. Linked to the PRItem for downstream lookup.
      for (const l of pr.items) {
        if (!l.item.hasSerialNo || l.serialNumbersInput.length === 0) continue;
        await tx.serialNo.createMany({
          data: l.serialNumbersInput.map((s) => ({
            tenantId,
            serialNo: s,
            itemId: l.itemId,
            warehouseId: l.warehouseId,
            status: "Active",
            purchaseReceiptItemId: l.id,
          })),
        });
      }

      // C6: upsert Batch and add this line's stock-UOM qty to batchQty.
      // (Batch qty is always in stock UOM regardless of transaction UOM.)
      for (const l of pr.items) {
        if (!l.item.hasBatchNo || !l.batchNo) continue;
        const bq = l.stockQty ?? l.qty;
        await tx.batch.upsert({
          where: {
            tenantId_itemId_batchNo: {
              tenantId,
              itemId: l.itemId,
              batchNo: l.batchNo,
            },
          },
          create: {
            tenantId,
            batchNo: l.batchNo,
            itemId: l.itemId,
            manufactureDate: l.manufactureDate,
            expiryDate: l.expiryDate,
            batchQty: bq,
          },
          update: {
            batchQty: { increment: bq },
          },
        });
      }

      // C1: bump receivedQty on any linked POItems + flip the PO to
      // Completed once every line is fully received.
      const poIds = new Set<string>();
      for (const l of pr.items) {
        if (!l.purchaseOrderItemId) continue;
        await tx.purchaseOrderItem.update({
          where: { id: l.purchaseOrderItemId },
          data: { receivedQty: { increment: new Prisma.Decimal(l.qty) } },
        });
        const poItem = await tx.purchaseOrderItem.findUnique({
          where: { id: l.purchaseOrderItemId },
          select: { purchaseOrderId: true },
        });
        if (poItem) poIds.add(poItem.purchaseOrderId);
      }
      for (const poId of poIds) {
        const items = await tx.purchaseOrderItem.findMany({
          where: { purchaseOrderId: poId },
          select: { qty: true, receivedQty: true },
        });
        const allDone = items.every(
          (i) => Number(i.receivedQty) >= Number(i.qty) - 0.0001,
        );
        if (allDone) {
          await tx.purchaseOrder.update({
            where: { id: poId },
            data: { status: "Completed" },
          });
        }
      }

      return tx.purchaseReceipt.update({
        where: { id: pr.id },
        data: { status: "Submitted" },
        include: { items: true },
      });
    });
    void publishRealtime(tenantId, "purchase-receipt", { id: result.id, status: "Submitted" });
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(msg === "Not found" ? 404 : 400).json({ error: msg });
  }
});

purchaseReceiptRouter.post("/:id/cancel", p.cancel, idempotency("POST /purchase-receipts/:id/cancel"), async (req, res) => {
  const tenantId = req.auth!.tenantId;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const pr = await tx.purchaseReceipt.findFirst({
        where: { id: req.params.id, tenantId },
        include: { items: true },
      });
      if (!pr) throw new Error("Not found");
      if (pr.status === "Cancelled") throw new Error("Already cancelled");

      if (pr.status === "Submitted") {
        await cancelStockEntries(tx, {
          tenantId,
          voucherType: "PurchaseReceipt",
          voucherId: pr.id,
        });
        await cancelGLEntries(tx, {
          tenantId,
          voucherType: "PurchaseReceipt",
          voucherId: pr.id,
        });
        // C6 + C7: reverse batch qty in stock UOM.
        for (const l of pr.items) {
          if (!l.batchNo) continue;
          const bq = l.stockQty ?? l.qty;
          const b = await tx.batch.findUnique({
            where: {
              tenantId_itemId_batchNo: {
                tenantId,
                itemId: l.itemId,
                batchNo: l.batchNo,
              },
            },
          });
          if (!b) continue;
          if (Number(b.batchQty) < Number(bq))
            throw new Error(
              `Cannot cancel — batch ${l.batchNo} has less qty than this PR contributed (some was shipped)`,
            );
          await tx.batch.update({
            where: { id: b.id },
            data: { batchQty: { decrement: bq } },
          });
        }

        // C5: mark this PR's serials Cancelled. Refuse if any of them are
        // Delivered — cancel the DN first to release them.
        const serials = await tx.serialNo.findMany({
          where: {
            tenantId,
            purchaseReceiptItemId: { in: pr.items.map((i) => i.id) },
          },
          select: { id: true, serialNo: true, status: true },
        });
        const alreadyDelivered = serials.filter((s) => s.status === "Delivered");
        if (alreadyDelivered.length > 0)
          throw new Error(
            `Cannot cancel — these serials have been shipped: ${alreadyDelivered
              .map((s) => s.serialNo)
              .join(", ")}. Cancel the Delivery Note first.`,
          );
        if (serials.length > 0)
          await tx.serialNo.updateMany({
            where: { id: { in: serials.map((s) => s.id) } },
            data: { status: "Cancelled", warehouseId: null },
          });

        // C1: reverse the receivedQty tally on any linked POItems, and if
        // the PO had been auto-flipped to Completed, roll it back to
        // "To Receive".
        const poIds = new Set<string>();
        for (const l of pr.items) {
          if (!l.purchaseOrderItemId) continue;
          await tx.purchaseOrderItem.update({
            where: { id: l.purchaseOrderItemId },
            data: { receivedQty: { decrement: new Prisma.Decimal(l.qty) } },
          });
          const poItem = await tx.purchaseOrderItem.findUnique({
            where: { id: l.purchaseOrderItemId },
            select: { purchaseOrderId: true },
          });
          if (poItem) poIds.add(poItem.purchaseOrderId);
        }
        for (const poId of poIds) {
          const po = await tx.purchaseOrder.findUnique({
            where: { id: poId },
            select: { status: true },
          });
          if (po?.status === "Completed") {
            await tx.purchaseOrder.update({
              where: { id: poId },
              data: { status: "To Receive" },
            });
          }
        }
      }

      return tx.purchaseReceipt.update({
        where: { id: pr.id },
        data: { status: "Cancelled" },
      });
    });
    void publishRealtime(tenantId, "purchase-receipt", { id: result.id, status: "Cancelled" });
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(msg === "Not found" ? 404 : 400).json({ error: msg });
  }
});

// Create a Draft PurchaseInvoice from a submitted PR. Each PI line back-links
// to its PR line via purchaseReceiptItemId; on PI submit, that back-link
// triggers the SRBNB → Creditors flip (see accounting-service PI submit).
// User can still submit the PI in buying-web to post the GL flip.
purchaseReceiptRouter.post(
  "/:id/convert-to-invoice",
  p.submit,
  perms("PurchaseInvoice").create,
  async (req, res) => {
    const tenantId = req.auth!.tenantId;
    try {
      const result = await prisma.$transaction(async (tx) => {
        const pr = await tx.purchaseReceipt.findFirst({
          where: { id: req.params.id, tenantId },
          include: { items: true },
        });
        if (!pr) throw new Error("Not found");
        if (pr.status !== "Submitted")
          throw new Error(`Cannot invoice PR in status ${pr.status}`);

        // Reject if any of these PR items are already invoiced. Keeps the
        // 1-to-1 model simple; splitting a PR across multiple PIs can come
        // later.
        const already = await tx.purchaseInvoiceItem.findFirst({
          where: { purchaseReceiptItemId: { in: pr.items.map((i) => i.id) } },
          select: { id: true },
        });
        if (already) throw new Error("This receipt has already been invoiced");

        const piName = await nextName(tx, tenantId, "PINV-");

        const netTotal = pr.items.reduce(
          (s, l) => s.add(new Prisma.Decimal(l.qty).mul(l.rate)),
          new Prisma.Decimal(0),
        );

        const pi = await tx.purchaseInvoice.create({
          data: {
            tenantId,
            name: piName,
            supplierId: pr.supplierId,
            supplierInvoiceNo: pr.supplierDeliveryNo,
            postingDate: new Date(),
            currency: "INR",
            conversionRate: new Prisma.Decimal(1),
            netTotal,
            totalTaxes: new Prisma.Decimal(0),
            grandTotal: netTotal,
            outstandingAmt: netTotal,
            status: "Draft",
            remarks: `From ${pr.name}`,
            items: {
              create: pr.items.map((l) => ({
                itemId: l.itemId,
                qty: l.qty,
                rate: l.rate,
                amount: new Prisma.Decimal(l.qty).mul(l.rate),
                purchaseReceiptItemId: l.id,
              })),
            },
          },
          include: { items: true },
        });

        return { purchaseInvoice: pi };
      });
      res.status(201).json(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed";
      res.status(msg === "Not found" ? 404 : 400).json({ error: msg });
    }
  },
);
