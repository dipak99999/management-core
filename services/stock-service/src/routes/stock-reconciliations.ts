import { Router } from "express";
import { z } from "zod";
import {
  Prisma,
  cancelGLEntries,
  classifyRecon,
  nextName,
  parseStockCountRows,
  postGLEntries,
  prisma,
  requireTenantDefaults,
} from "@lumaara/db";
import { cancelStockEntries, postStockEntries } from "../lib/stock-posting";
import { idempotency, perms, publishRealtime } from "@lumaara/service-auth";

// C3: Stock Reconciliation. User counts warehouse stock, records
// (countedQty, countedRate) per (item, warehouse); on submit the route
// generates SLE deltas + a value-delta GL post to Stock in Hand vs
// Stock Adjustment.

export const stockReconciliationRouter = Router();

const p = perms("StockReconciliation");

const itemLineSchema = z.object({
  itemId: z.string().min(1),
  warehouseId: z.string().min(1),
  countedQty: z.coerce.number().nonnegative(),
  countedValuationRate: z.coerce.number().nonnegative().optional().nullable(),
});

const upsertSchema = z.object({
  postingDate: z.string().datetime().optional(),
  purpose: z.enum(["Stock Reconciliation", "Opening Stock"]).default("Stock Reconciliation"),
  remarks: z.string().optional().nullable(),
  items: z.array(itemLineSchema).min(1),
});

stockReconciliationRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.stockReconciliation.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: { postingDate: "desc" },
  });
  res.json(rows);
});

// C3+: Bulk CSV import — accepts a scanner/spreadsheet CSV and creates a
// Draft SR with one row per parsed line. Errors from parseStockCountRows
// come back in the response so the UI can surface all issues at once.
// The staff still reviews + submits the Draft manually.
//
// Route order: MUST precede GET /:id below so Express doesn't match
// /:id first with id="bulk-import" (same pattern as the /pricing-rules
// fix in module 15).
const bulkImportSchema = z.object({
  csv: z.string().min(1).max(5_000_000), // 5MB cap
  postingDate: z.string().datetime().optional(),
  purpose: z.enum(["Stock Reconciliation", "Opening Stock"]).default("Stock Reconciliation"),
  remarks: z.string().optional().nullable(),
});

stockReconciliationRouter.post("/bulk-import", p.create, async (req, res) => {
  const parsed = bulkImportSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;

  // Preload tenant-scoped lookup maps (all items + warehouses) once.
  // Names arrive from the CSV in whatever casing the user typed; we
  // lowercase both sides for match.
  const [items, warehouses] = await Promise.all([
    prisma.item.findMany({
      where: { tenantId, isStockItem: true },
      select: { id: true, itemCode: true },
    }),
    prisma.warehouse.findMany({
      where: { tenantId, disabled: false, isGroup: false },
      select: { id: true, warehouseName: true },
    }),
  ]);
  const itemCodeToId = new Map(items.map((i) => [i.itemCode.toLowerCase(), i.id]));
  const warehouseNameToId = new Map(
    warehouses.map((w) => [w.warehouseName.toLowerCase(), w.id]),
  );

  const parseResult = parseStockCountRows(parsed.data.csv, {
    itemCodeToId,
    warehouseNameToId,
  });
  if (parseResult.errors.length > 0 && parseResult.rows.length === 0) {
    // All rows failed → don't create an SR; surface every parse error so
    // the user can fix + retry.
    return res.status(400).json({
      error: "CSV import produced no valid rows",
      details: parseResult.errors,
    });
  }
  if (parseResult.rows.length === 0) {
    return res.status(400).json({ error: "CSV had no data rows" });
  }

  // Snapshot bins so the SR line captures the "before" state at
  // create-time, same as the interactive form.
  const bins = await prisma.bin.findMany({
    where: {
      tenantId,
      OR: parseResult.rows.map((r) => ({
        itemId: r.itemId,
        warehouseId: r.warehouseId,
      })),
    },
  });
  const binMap = new Map(
    bins.map((b) => [`${b.itemId}::${b.warehouseId}`, b]),
  );

  const name = await nextName(prisma, tenantId, "SR-");
  const row = await prisma.stockReconciliation.create({
    data: {
      tenantId,
      name,
      postingDate: parsed.data.postingDate
        ? new Date(parsed.data.postingDate)
        : new Date(),
      purpose: parsed.data.purpose,
      remarks: parsed.data.remarks ?? null,
      status: "Draft",
      items: {
        create: parseResult.rows.map((r) => {
          const b = binMap.get(`${r.itemId}::${r.warehouseId}`);
          return {
            itemId: r.itemId,
            warehouseId: r.warehouseId,
            currentQty: b?.actualQty ?? new Prisma.Decimal(0),
            currentValuationRate: b?.valuationRate ?? new Prisma.Decimal(0),
            countedQty: new Prisma.Decimal(r.countedQty),
            countedValuationRate:
              r.countedValuationRate != null
                ? new Prisma.Decimal(r.countedValuationRate)
                : null,
          };
        }),
      },
    },
    include: { items: true },
  });
  res.status(201).json({
    id: row.id,
    name: row.name,
    itemCount: row.items.length,
    warnings: parseResult.errors,
  });
});

stockReconciliationRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.stockReconciliation.findFirst({
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

// Snapshot current bin state onto the new SR line at create-time so users
// can see the "before" value while counting.
async function snapshotBins(
  tenantId: string,
  data: z.infer<typeof upsertSchema>,
): Promise<
  {
    itemId: string;
    warehouseId: string;
    currentQty: Prisma.Decimal;
    currentValuationRate: Prisma.Decimal;
    countedQty: Prisma.Decimal;
    countedValuationRate: Prisma.Decimal | null;
  }[]
> {
  const bins = await prisma.bin.findMany({
    where: {
      tenantId,
      OR: data.items.map((i) => ({
        itemId: i.itemId,
        warehouseId: i.warehouseId,
      })),
    },
  });
  const key = (a: string, b: string) => `${a}::${b}`;
  const binMap = new Map(bins.map((b) => [key(b.itemId, b.warehouseId), b]));
  return data.items.map((i) => {
    const b = binMap.get(key(i.itemId, i.warehouseId));
    return {
      itemId: i.itemId,
      warehouseId: i.warehouseId,
      currentQty: b?.actualQty ?? new Prisma.Decimal(0),
      currentValuationRate: b?.valuationRate ?? new Prisma.Decimal(0),
      countedQty: new Prisma.Decimal(i.countedQty),
      countedValuationRate:
        i.countedValuationRate != null
          ? new Prisma.Decimal(i.countedValuationRate)
          : null,
    };
  });
}

stockReconciliationRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = parsed.data;
  const tenantId = req.auth!.tenantId;

  const itemIds = data.items.map((i) => i.itemId);
  const validItems = await prisma.item.findMany({
    where: { id: { in: itemIds }, tenantId, isStockItem: true },
    select: { id: true },
  });
  if (validItems.length !== new Set(itemIds).size)
    return res.status(400).json({ error: "One or more items are invalid or non-stock" });

  const lineData = await snapshotBins(tenantId, data);
  const name = await nextName(prisma, tenantId, "SR-");
  const row = await prisma.stockReconciliation.create({
    data: {
      tenantId,
      name,
      postingDate: data.postingDate ? new Date(data.postingDate) : new Date(),
      purpose: data.purpose,
      remarks: data.remarks ?? null,
      status: "Draft",
      items: { create: lineData },
    },
    include: { items: true },
  });
  res.status(201).json(row);
});

stockReconciliationRouter.put("/:id", p.write, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = parsed.data;
  const tenantId = req.auth!.tenantId;

  const existing = await prisma.stockReconciliation.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.status !== "Draft")
    return res.status(400).json({ error: `Cannot edit SR in status ${existing.status}` });

  const lineData = await snapshotBins(tenantId, data);
  const updated = await prisma.$transaction(async (tx) => {
    await tx.stockReconciliationItem.deleteMany({
      where: { stockReconciliationId: existing.id },
    });
    return tx.stockReconciliation.update({
      where: { id: existing.id },
      data: {
        postingDate: data.postingDate ? new Date(data.postingDate) : existing.postingDate,
        purpose: data.purpose,
        remarks: data.remarks ?? null,
        items: { create: lineData },
      },
      include: { items: true },
    });
  });
  res.json(updated);
});

// Submit: for each line, classify (none / qty / rate / both) and post
// the appropriate ledger:
//   qty | both → postStockEntries (moving-average handles inflow/outflow)
//   rate       → value-only SLE (actualQty=0) + direct Bin update. The
//                cancel path's rebuildBin ignores value-only SLEs and
//                reconstructs the bin from qty-moving SLEs alone, so
//                cancelling the recon cleanly reverts the rate change.
//   none       → skip
// Then post GL for the sum of value deltas:
//   +delta (stock gain) → Dr Stock in Hand / Cr Stock Adjustment
//   -delta (stock loss) → Dr Stock Adjustment / Cr Stock in Hand
stockReconciliationRouter.post("/:id/submit", p.submit, idempotency("POST /stock-reconciliations/:id/submit"), async (req, res) => {
  const tenantId = req.auth!.tenantId;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const sr = await tx.stockReconciliation.findFirst({
        where: { id: req.params.id, tenantId },
        include: { items: true },
      });
      if (!sr) throw new Error("Not found");
      if (sr.status !== "Draft") throw new Error(`Cannot submit SR in status ${sr.status}`);

      const defaults = await requireTenantDefaults(tx, tenantId, [
        "defaultStockInHandAccountId",
        "defaultStockAdjustmentAccountId",
      ]);

      // Re-fetch bin state now (not the snapshot) so a stale draft doesn't
      // post against an outdated baseline.
      const qtyLines: {
        itemId: string;
        warehouseId: string;
        actualQty: number;
        incomingRate?: number;
      }[] = [];
      // Rate-only bumps: emitted after postStockEntries so the pure
      // rate revaluation lands after any qty flow settles (though for
      // rate-only mode there's no qty flow to sequence against).
      const rateOnlyBumps: {
        itemId: string;
        warehouseId: string;
        countedQty: number;
        newRate: number;
        newStockValue: number;
      }[] = [];
      let valueDelta = 0;
      for (const l of sr.items) {
        const bin = await tx.bin.findUnique({
          where: {
            tenantId_itemId_warehouseId: {
              tenantId,
              itemId: l.itemId,
              warehouseId: l.warehouseId,
            },
          },
        });
        const oldQty = bin ? Number(bin.actualQty) : 0;
        const oldRate = bin ? Number(bin.valuationRate) : 0;
        const countedQty = Number(l.countedQty);
        const countedRate =
          l.countedValuationRate != null ? Number(l.countedValuationRate) : null;

        const change = classifyRecon({ oldQty, oldRate, countedQty, countedRate });
        if (change.mode === "none") continue;

        valueDelta += change.valueDelta;

        if (change.mode === "qty" || change.mode === "both") {
          const isGain = change.qtyDelta > 0;
          qtyLines.push({
            itemId: l.itemId,
            warehouseId: l.warehouseId,
            actualQty: change.qtyDelta,
            // Inflows use countedRate so the moving average pulls toward
            // the counted value. Outflows leave incomingRate unset (consume
            // at existing avg — see stock-posting.ts).
            ...(isGain
              ? {
                  incomingRate:
                    countedRate ?? oldRate,
                }
              : {}),
          });
        }
        if (change.mode === "rate") {
          rateOnlyBumps.push({
            itemId: l.itemId,
            warehouseId: l.warehouseId,
            countedQty,
            newRate: change.newValuationRate,
            newStockValue: change.newStockValue,
          });
        }
      }

      if (qtyLines.length > 0) {
        await postStockEntries(tx, {
          tenantId,
          postingDate: sr.postingDate,
          voucherType: "StockReconciliation",
          voucherId: sr.id,
          voucherName: sr.name,
          lines: qtyLines,
        });
      }

      // Rate-only revaluations: write value-only SLE + force Bin. The
      // cancel path's rebuildBin ignores actualQty=0 SLEs so this
      // reverts cleanly on cancel.
      for (const bump of rateOnlyBumps) {
        await tx.stockLedgerEntry.create({
          data: {
            tenantId,
            postingDate: sr.postingDate,
            itemId: bump.itemId,
            warehouseId: bump.warehouseId,
            actualQty: new Prisma.Decimal(0),
            qtyAfterTransaction: new Prisma.Decimal(bump.countedQty),
            incomingRate: new Prisma.Decimal(0),
            valuationRate: new Prisma.Decimal(bump.newRate),
            stockValue: new Prisma.Decimal(bump.newStockValue),
            voucherType: "StockReconciliation",
            voucherId: sr.id,
            voucherName: sr.name,
            isCancelled: false,
          },
        });
        await tx.bin.update({
          where: {
            tenantId_itemId_warehouseId: {
              tenantId,
              itemId: bump.itemId,
              warehouseId: bump.warehouseId,
            },
          },
          data: {
            valuationRate: new Prisma.Decimal(bump.newRate),
            stockValue: new Prisma.Decimal(bump.newStockValue),
          },
        });
      }

      if (Math.abs(valueDelta) > 0.0001) {
        const gain = valueDelta > 0;
        await postGLEntries(tx, {
          tenantId,
          postingDate: sr.postingDate,
          voucherType: "StockReconciliation",
          voucherId: sr.id,
          voucherName: sr.name,
          lines: [
            {
              accountId: defaults.defaultStockInHandAccountId!,
              debit: gain ? valueDelta : 0,
              credit: gain ? 0 : -valueDelta,
            },
            {
              accountId: defaults.defaultStockAdjustmentAccountId!,
              debit: gain ? 0 : -valueDelta,
              credit: gain ? valueDelta : 0,
              remarks: gain ? "Stock gain from reconciliation" : "Stock loss from reconciliation",
            },
          ],
        });
      }

      return tx.stockReconciliation.update({
        where: { id: sr.id },
        data: { status: "Submitted" },
      });
    });
    void publishRealtime(tenantId, "stock-reconciliation", { id: result.id, status: "Submitted" });
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(msg === "Not found" ? 404 : 400).json({ error: msg });
  }
});

stockReconciliationRouter.post("/:id/cancel", p.cancel, idempotency("POST /stock-reconciliations/:id/cancel"), async (req, res) => {
  const tenantId = req.auth!.tenantId;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const sr = await tx.stockReconciliation.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!sr) throw new Error("Not found");
      if (sr.status === "Cancelled") throw new Error("Already cancelled");
      if (sr.status === "Submitted") {
        await cancelStockEntries(tx, {
          tenantId,
          voucherType: "StockReconciliation",
          voucherId: sr.id,
        });
        await cancelGLEntries(tx, {
          tenantId,
          voucherType: "StockReconciliation",
          voucherId: sr.id,
        });
      }
      return tx.stockReconciliation.update({
        where: { id: sr.id },
        data: { status: "Cancelled" },
      });
    });
    void publishRealtime(tenantId, "stock-reconciliation", { id: result.id, status: "Cancelled" });
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(msg === "Not found" ? 404 : 400).json({ error: msg });
  }
});
