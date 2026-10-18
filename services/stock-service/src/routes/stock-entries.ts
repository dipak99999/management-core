import { Router } from "express";
import { z } from "zod";
import { prisma, nextName } from "@lumaara/db";
import { cancelStockEntries, postStockEntries } from "../lib/stock-posting";
import { idempotency, perms, publishRealtime } from "@lumaara/service-auth";

export const stockEntryRouter = Router();

const p = perms("StockEntry");

const ENTRY_TYPES = [
  "Material Receipt",
  "Material Issue",
  "Material Transfer",
  // C8: Repack — consume RM lines (sourceWarehouseId only) + produce FG line
  // (targetWarehouseId only). Server enforces exactly one FG line and
  // conserves value: FG incoming rate = totalConsumedValue / FG.qty.
  "Repack",
] as const;

const itemLineSchema = z.object({
  itemId: z.string().min(1),
  qty: z.coerce.number().positive(),
  basicRate: z.coerce.number().nonnegative().default(0),
  sourceWarehouseId: z.string().optional().nullable(),
  targetWarehouseId: z.string().optional().nullable(),
});

const createSchema = z.object({
  entryType: z.enum(ENTRY_TYPES),
  postingDate: z.string().datetime().optional(),
  remarks: z.string().optional().nullable(),
  // Optional in-transit warehouse — only used when entryType is
  // "Material Transfer". When set, submit posts source-out +
  // in-transit-in and the entry sits in "In Transit" status until
  // POST /:id/receive posts in-transit-out + target-in.
  inTransitWarehouseId: z.string().optional().nullable(),
  items: z.array(itemLineSchema).min(1),
});

stockEntryRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.stockEntry.findMany({
    where: { tenantId: req.auth!.tenantId },
    include: {
      items: {
        include: {
          item: { select: { itemCode: true, itemName: true } },
          sourceWarehouse: { select: { warehouseName: true } },
          targetWarehouse: { select: { warehouseName: true } },
        },
      },
    },
    orderBy: { postingDate: "desc" },
  });
  res.json(rows);
});

stockEntryRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.stockEntry.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      items: {
        include: {
          item: true,
          sourceWarehouse: true,
          targetWarehouse: true,
        },
      },
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

// Full detail: SE + items + SLE (no GL — Stock Entry doesn't post to accounting;
// only DN/PR do perpetual inventory posting).
stockEntryRouter.get("/:id/full", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;

  const se = await prisma.stockEntry.findFirst({
    where: { id: req.params.id, tenantId },
    include: {
      inTransitWarehouse: { select: { warehouseName: true } },
      items: {
        include: {
          item: true,
          sourceWarehouse: true,
          targetWarehouse: true,
        },
      },
    },
  });
  if (!se) return res.status(404).json({ error: "Not found" });

  const slEntries = await prisma.stockLedgerEntry.findMany({
    where: {
      tenantId,
      voucherType: "StockEntry",
      voucherId: se.id,
      isCancelled: false,
    },
    include: {
      item: { select: { itemCode: true, itemName: true, stockUom: true } },
      warehouse: { select: { warehouseName: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  res.json({ stockEntry: se, slEntries });
});

// Enforce warehouse presence rules per entryType. Returns null on success
// or an error message string when validation fails.
function validateWarehouses(
  entryType: (typeof ENTRY_TYPES)[number],
  items: { sourceWarehouseId?: string | null; targetWarehouseId?: string | null }[],
): string | null {
  if (entryType === "Repack") {
    // Each line is either RM (source only) or FG (target only). Exactly one
    // FG line for MVP; multi-FG needs a weighted split (deferred).
    let fgCount = 0;
    let rmCount = 0;
    for (const line of items) {
      if (line.sourceWarehouseId && line.targetWarehouseId)
        return "Repack lines cannot have both source and target warehouses";
      if (line.sourceWarehouseId) rmCount++;
      else if (line.targetWarehouseId) fgCount++;
      else return "Repack line must have either source or target warehouse";
    }
    if (fgCount !== 1)
      return "Repack must have exactly one FG line (targetWarehouseId only)";
    if (rmCount < 1)
      return "Repack must have at least one RM line (sourceWarehouseId only)";
    return null;
  }
  for (const line of items) {
    if (entryType === "Material Receipt") {
      if (!line.targetWarehouseId) return "Material Receipt requires targetWarehouseId";
      if (line.sourceWarehouseId)
        return "Material Receipt should not have sourceWarehouseId";
    } else if (entryType === "Material Issue") {
      if (!line.sourceWarehouseId) return "Material Issue requires sourceWarehouseId";
      if (line.targetWarehouseId) return "Material Issue should not have targetWarehouseId";
    } else {
      if (!line.sourceWarehouseId || !line.targetWarehouseId)
        return "Material Transfer requires both sourceWarehouseId and targetWarehouseId";
      if (line.sourceWarehouseId === line.targetWarehouseId)
        return "Source and target warehouses must differ";
    }
  }
  return null;
}

// In-transit warehouse must belong to the same tenant, must NOT match
// any line's source or target (round-trip is nonsense), and is only
// meaningful for Material Transfer.
async function validateInTransit(
  tenantId: string,
  entryType: (typeof ENTRY_TYPES)[number],
  inTransitWarehouseId: string | null | undefined,
  items: { sourceWarehouseId?: string | null; targetWarehouseId?: string | null }[],
): Promise<string | null> {
  if (!inTransitWarehouseId) return null;
  if (entryType !== "Material Transfer") {
    return "inTransitWarehouseId is only valid for Material Transfer";
  }
  const wh = await prisma.warehouse.findFirst({
    where: { id: inTransitWarehouseId, tenantId },
    select: { id: true },
  });
  if (!wh) return "inTransitWarehouseId not found in this tenant";
  for (const l of items) {
    if (l.sourceWarehouseId === inTransitWarehouseId || l.targetWarehouseId === inTransitWarehouseId) {
      return "inTransitWarehouseId cannot equal any line's source or target warehouse";
    }
  }
  return null;
}

// Update a Draft SE. Wipes items and recreates. entryType is editable
// (validation re-runs against new type).
stockEntryRouter.put("/:id", p.write, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const p = parsed.data;
  const tenantId = req.auth!.tenantId;

  const existing = await prisma.stockEntry.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.status !== "Draft")
    return res.status(400).json({ error: `Cannot edit SE in status ${existing.status}` });

  const whErr = validateWarehouses(p.entryType, p.items);
  if (whErr) return res.status(400).json({ error: whErr });
  const itErr = await validateInTransit(tenantId, p.entryType, p.inTransitWarehouseId, p.items);
  if (itErr) return res.status(400).json({ error: itErr });

  const updated = await prisma.$transaction(async (tx) => {
    await tx.stockEntryItem.deleteMany({ where: { stockEntryId: existing.id } });
    return tx.stockEntry.update({
      where: { id: existing.id },
      data: {
        entryType: p.entryType,
        postingDate: p.postingDate ? new Date(p.postingDate) : existing.postingDate,
        remarks: p.remarks ?? null,
        inTransitWarehouseId: p.inTransitWarehouseId ?? null,
        items: {
          create: p.items.map((i) => ({
            itemId: i.itemId,
            qty: i.qty,
            basicRate: i.basicRate,
            sourceWarehouseId: i.sourceWarehouseId ?? null,
            targetWarehouseId: i.targetWarehouseId ?? null,
          })),
        },
      },
      include: { items: true },
    });
  });
  res.json(updated);
});

stockEntryRouter.post("/", p.create, idempotency("POST /stock-entries"), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const p = parsed.data;
  const tenantId = req.auth!.tenantId;

  const whErr = validateWarehouses(p.entryType, p.items);
  if (whErr) return res.status(400).json({ error: whErr });
  const itErr = await validateInTransit(tenantId, p.entryType, p.inTransitWarehouseId, p.items);
  if (itErr) return res.status(400).json({ error: itErr });

  const name = await nextName(prisma, tenantId, "STE-");
  const row = await prisma.stockEntry.create({
    data: {
      tenantId,
      name,
      entryType: p.entryType,
      postingDate: p.postingDate ? new Date(p.postingDate) : new Date(),
      remarks: p.remarks ?? null,
      status: "Draft",
      inTransitWarehouseId: p.inTransitWarehouseId ?? null,
      items: {
        create: p.items.map((i) => ({
          itemId: i.itemId,
          qty: i.qty,
          basicRate: i.basicRate,
          sourceWarehouseId: i.sourceWarehouseId ?? null,
          targetWarehouseId: i.targetWarehouseId ?? null,
        })),
      },
    },
    include: { items: true },
  });
  res.status(201).json(row);
});

// Submit: for each line, post SLE(s) and update Bin.
//   Material Receipt  -> +qty at target (valuation = basicRate)
//   Material Issue    -> -qty at source (valuation = current avg)
//   Material Transfer -> -qty at source AND +qty at target (target valuation
//     inherits the source's current avg rate)
stockEntryRouter.post("/:id/submit", p.submit, idempotency("POST /stock-entries/:id/submit"), async (req, res) => {
  const tenantId = req.auth!.tenantId;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const se = await tx.stockEntry.findFirst({
        where: { id: req.params.id, tenantId },
        include: { items: true },
      });
      if (!se) throw new Error("Not found");
      if (se.status !== "Draft") throw new Error(`Cannot submit in status ${se.status}`);

      // Build the SLE lines. For transfers we need the source's current rate
      // to pass as the target's incoming rate — read it here up-front.
      const postLines: {
        itemId: string;
        warehouseId: string;
        actualQty: number;
        incomingRate?: number;
      }[] = [];

      if (se.entryType === "Repack") {
        // C8: two-phase. First consume every RM line at its bin's current
        // rate, tallying totalConsumedValue. Then produce the single FG line
        // at incomingRate = totalConsumedValue / fgQty (value conservation).
        let totalConsumedValue = 0;
        const rmLines = se.items.filter((l) => l.sourceWarehouseId);
        const fgLine = se.items.find((l) => l.targetWarehouseId)!;
        for (const line of rmLines) {
          const bin = await tx.bin.findUnique({
            where: {
              tenantId_itemId_warehouseId: {
                tenantId,
                itemId: line.itemId,
                warehouseId: line.sourceWarehouseId!,
              },
            },
            select: { valuationRate: true, actualQty: true },
          });
          const rate = Number(bin?.valuationRate ?? 0);
          totalConsumedValue += Number(line.qty) * rate;
          postLines.push({
            itemId: line.itemId,
            warehouseId: line.sourceWarehouseId!,
            actualQty: -Number(line.qty),
          });
        }
        const fgQty = Number(fgLine.qty);
        const fgIncomingRate = fgQty > 0 ? totalConsumedValue / fgQty : 0;
        postLines.push({
          itemId: fgLine.itemId,
          warehouseId: fgLine.targetWarehouseId!,
          actualQty: fgQty,
          incomingRate: fgIncomingRate,
        });
      } else {
        for (const line of se.items) {
          const qty = Number(line.qty);
          if (se.entryType === "Material Receipt") {
            postLines.push({
              itemId: line.itemId,
              warehouseId: line.targetWarehouseId!,
              actualQty: qty,
              incomingRate: Number(line.basicRate),
            });
          } else if (se.entryType === "Material Issue") {
            postLines.push({
              itemId: line.itemId,
              warehouseId: line.sourceWarehouseId!,
              actualQty: -qty,
            });
          } else {
            // Material Transfer: source out first, then either target or
            // in-transit in — depending on whether the entry uses the
            // in-transit flow.
            const sourceBin = await tx.bin.findUnique({
              where: {
                tenantId_itemId_warehouseId: {
                  tenantId,
                  itemId: line.itemId,
                  warehouseId: line.sourceWarehouseId!,
                },
              },
              select: { valuationRate: true },
            });
            const rate = Number(sourceBin?.valuationRate ?? 0);
            postLines.push({
              itemId: line.itemId,
              warehouseId: line.sourceWarehouseId!,
              actualQty: -qty,
            });
            const receiveWarehouseId =
              se.inTransitWarehouseId ?? line.targetWarehouseId!;
            postLines.push({
              itemId: line.itemId,
              warehouseId: receiveWarehouseId,
              actualQty: qty,
              incomingRate: rate,
            });
          }
        }
      }

      await postStockEntries(tx, {
        tenantId,
        postingDate: se.postingDate,
        voucherType: "StockEntry",
        voucherId: se.id,
        voucherName: se.name,
        lines: postLines,
      });

      // In-transit transfers sit at "In Transit" until /receive fires.
      const nextStatus =
        se.entryType === "Material Transfer" && se.inTransitWarehouseId
          ? "In Transit"
          : "Submitted";
      return tx.stockEntry.update({
        where: { id: se.id },
        data: { status: nextStatus },
        include: { items: true },
      });
    });
    void publishRealtime(req.auth!.tenantId, "stock-entry", { id: result.id, status: result.status });
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(msg === "Not found" ? 404 : 400).json({ error: msg });
  }
});

// Complete an in-transit transfer: pull stock out of the in-transit
// warehouse and into the final target. Reads the current in-transit bin
// rate so valuation carries through the second leg cleanly.
stockEntryRouter.post("/:id/receive", p.submit, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const se = await tx.stockEntry.findFirst({
        where: { id: req.params.id, tenantId },
        include: { items: true },
      });
      if (!se) throw new Error("Not found");
      if (se.status !== "In Transit") {
        throw new Error(`Cannot receive an entry in status ${se.status}`);
      }
      if (!se.inTransitWarehouseId) {
        throw new Error("This entry has no inTransitWarehouseId");
      }
      if (se.entryType !== "Material Transfer") {
        throw new Error("Only Material Transfer entries can be received");
      }

      const postLines: {
        itemId: string;
        warehouseId: string;
        actualQty: number;
        incomingRate?: number;
      }[] = [];
      for (const line of se.items) {
        const qty = Number(line.qty);
        const bin = await tx.bin.findUnique({
          where: {
            tenantId_itemId_warehouseId: {
              tenantId,
              itemId: line.itemId,
              warehouseId: se.inTransitWarehouseId!,
            },
          },
          select: { valuationRate: true },
        });
        const rate = Number(bin?.valuationRate ?? 0);
        postLines.push({
          itemId: line.itemId,
          warehouseId: se.inTransitWarehouseId!,
          actualQty: -qty,
        });
        postLines.push({
          itemId: line.itemId,
          warehouseId: line.targetWarehouseId!,
          actualQty: qty,
          incomingRate: rate,
        });
      }

      await postStockEntries(tx, {
        tenantId,
        postingDate: new Date(),
        voucherType: "StockEntry",
        voucherId: se.id,
        voucherName: se.name,
        lines: postLines,
      });

      return tx.stockEntry.update({
        where: { id: se.id },
        data: {
          status: "Submitted",
          receivedAt: new Date(),
          receivedByUserId: req.auth!.userId,
        },
        include: { items: true },
      });
    });
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(msg === "Not found" ? 404 : 400).json({ error: msg });
  }
});

stockEntryRouter.post("/:id/cancel", p.cancel, idempotency("POST /stock-entries/:id/cancel"), async (req, res) => {
  const tenantId = req.auth!.tenantId;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const se = await tx.stockEntry.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!se) throw new Error("Not found");
      if (se.status === "Cancelled") throw new Error("Already cancelled");

      // Cancels reverse every SLE keyed on (voucherType, voucherId) —
      // that covers both the initial submit AND any /receive that fired
      // after, since both post under the same voucher key.
      if (se.status === "Submitted" || se.status === "In Transit") {
        await cancelStockEntries(tx, {
          tenantId,
          voucherType: "StockEntry",
          voucherId: se.id,
        });
      }

      return tx.stockEntry.update({
        where: { id: se.id },
        data: { status: "Cancelled" },
      });
    });
    void publishRealtime(req.auth!.tenantId, "stock-entry", { id: result.id, status: "Cancelled" });
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(msg === "Not found" ? 404 : 400).json({ error: msg });
  }
});
