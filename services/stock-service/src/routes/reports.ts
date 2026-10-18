import { Router } from "express";
import { prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

export const stockReportsRouter = Router();

const p = perms("Report");

// Stock Balance: current Bin snapshot with item + warehouse names.
// Optional filter: ?warehouseId=X to scope to one warehouse.
stockReportsRouter.get("/stock-balance", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const warehouseId =
    typeof req.query.warehouseId === "string" ? req.query.warehouseId : undefined;
  const itemId =
    typeof req.query.itemId === "string" ? req.query.itemId : undefined;
  // C3: SR-new-form uses (itemId, warehouseId) to snapshot the bin for a
  // specific pair. When itemId is supplied we drop the "hide zero-qty" filter
  // so an empty bin still returns a row.
  const targeted = !!itemId && !!warehouseId;

  const rows = await prisma.bin.findMany({
    where: {
      tenantId,
      ...(warehouseId ? { warehouseId } : {}),
      ...(itemId ? { itemId } : {}),
      ...(targeted ? {} : { actualQty: { not: 0 } }),
    },
    include: {
      item: { select: { itemCode: true, itemName: true, stockUom: true } },
      warehouse: { select: { warehouseName: true } },
    },
    orderBy: [{ warehouse: { warehouseName: "asc" } }, { item: { itemCode: "asc" } }],
  });

  const totalStockValue = rows.reduce((s, r) => s + Number(r.stockValue), 0);

  res.json({ rows, totalStockValue });
});

// Dashboard summary for the shell home page.
stockReportsRouter.get("/dashboard-summary", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;

  const [bins, itemsWithStock, openWorkOrders, todayDeliveries] = await Promise.all([
    prisma.bin.aggregate({
      where: { tenantId, actualQty: { not: 0 } },
      _sum: { stockValue: true },
    }),
    prisma.bin.count({
      where: { tenantId, actualQty: { gt: 0 } },
    }),
    prisma.workOrder.count({
      where: {
        tenantId,
        status: { in: ["Not Started", "In Process"] },
      },
    }),
    prisma.deliveryNote.count({
      where: {
        tenantId,
        status: "Submitted",
        postingDate: {
          gte: new Date(new Date().setHours(0, 0, 0, 0)),
          lt: new Date(new Date().setHours(24, 0, 0, 0)),
        },
      },
    }),
  ]);

  res.json({
    totalStockValue: Number(bins._sum.stockValue ?? 0),
    itemsInStock: itemsWithStock,
    openWorkOrders,
    todayDeliveries,
  });
});

// C14: Stock aging. Buckets on-hand qty per (item, warehouse) into
// [0-30, 30-60, 60-90, 90+] days from the postingDate of the SLE layer
// that still holds each unit. FIFO walk of non-cancelled SLEs:
//   +qty (incoming): push layer {qty, postingDate}
//   -qty (outgoing): consume from front (FIFO)
// Remaining layers = current stock; age = today − layer date.
stockReportsRouter.get("/stock-aging", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const warehouseId =
    typeof req.query.warehouseId === "string" ? req.query.warehouseId : undefined;
  const sles = await prisma.stockLedgerEntry.findMany({
    where: {
      tenantId,
      isCancelled: false,
      ...(warehouseId ? { warehouseId } : {}),
    },
    include: {
      item: { select: { itemCode: true, itemName: true, stockUom: true } },
      warehouse: { select: { warehouseName: true } },
    },
    orderBy: [
      { itemId: "asc" },
      { warehouseId: "asc" },
      { postingDate: "asc" },
      { createdAt: "asc" },
    ],
  });
  // Group by (item, warehouse) and FIFO-consume.
  interface Layer { qty: number; date: Date }
  const byKey = new Map<
    string,
    {
      itemId: string;
      itemCode: string;
      itemName: string;
      stockUom: string;
      warehouseId: string;
      warehouseName: string;
      layers: Layer[];
    }
  >();
  for (const sle of sles) {
    const key = `${sle.itemId}::${sle.warehouseId}`;
    let g = byKey.get(key);
    if (!g) {
      g = {
        itemId: sle.itemId,
        itemCode: sle.item.itemCode,
        itemName: sle.item.itemName,
        stockUom: sle.item.stockUom,
        warehouseId: sle.warehouseId,
        warehouseName: sle.warehouse.warehouseName,
        layers: [],
      };
      byKey.set(key, g);
    }
    const q = Number(sle.actualQty);
    if (q > 0) {
      g.layers.push({ qty: q, date: sle.postingDate });
    } else if (q < 0) {
      let need = -q;
      while (need > 1e-9 && g.layers.length > 0) {
        const head = g.layers[0];
        if (head.qty <= need + 1e-9) {
          need -= head.qty;
          g.layers.shift();
        } else {
          head.qty -= need;
          need = 0;
        }
      }
    }
  }
  const now = Date.now();
  const rows = [...byKey.values()]
    .map((g) => {
      const totalQty = g.layers.reduce((s, l) => s + l.qty, 0);
      const buckets = { d0_30: 0, d30_60: 0, d60_90: 0, d90_plus: 0 };
      let oldestDays = 0;
      for (const l of g.layers) {
        const days = Math.max(0, (now - l.date.getTime()) / 86400000);
        if (days > oldestDays) oldestDays = days;
        if (days <= 30) buckets.d0_30 += l.qty;
        else if (days <= 60) buckets.d30_60 += l.qty;
        else if (days <= 90) buckets.d60_90 += l.qty;
        else buckets.d90_plus += l.qty;
      }
      return {
        itemId: g.itemId,
        itemCode: g.itemCode,
        itemName: g.itemName,
        stockUom: g.stockUom,
        warehouseId: g.warehouseId,
        warehouseName: g.warehouseName,
        totalQty,
        oldestDays: Math.round(oldestDays),
        buckets,
      };
    })
    .filter((r) => r.totalQty > 0.0001);
  res.json({ rows, asOf: new Date().toISOString() });
});

// C14: ABC analysis. Ranks items by total sales value in a period, then
// buckets by cumulative % of value: A (≤ 80%), B (80-95%), C (95-100%).
// Uses SalesInvoiceItem × invoice.postingDate range × conversionRate.
stockReportsRouter.get("/abc-analysis", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const from =
    typeof req.query.from === "string"
      ? new Date(req.query.from)
      : new Date(new Date().setMonth(new Date().getMonth() - 12));
  const to =
    typeof req.query.to === "string" ? new Date(req.query.to) : new Date();
  const lines = await prisma.salesInvoiceItem.findMany({
    where: {
      salesInvoice: {
        tenantId,
        status: { in: ["Submitted", "Paid"] },
        postingDate: { gte: from, lte: to },
      },
    },
    include: {
      item: { select: { itemCode: true, itemName: true, stockUom: true } },
      salesInvoice: { select: { conversionRate: true } },
    },
  });
  const agg = new Map<
    string,
    {
      itemId: string;
      itemCode: string;
      itemName: string;
      stockUom: string;
      qty: number;
      revenue: number;
    }
  >();
  for (const l of lines) {
    const fx = Number(l.salesInvoice.conversionRate);
    const revenue = Number(l.amount) * fx;
    const g = agg.get(l.itemId) ?? {
      itemId: l.itemId,
      itemCode: l.item.itemCode,
      itemName: l.item.itemName,
      stockUom: l.item.stockUom,
      qty: 0,
      revenue: 0,
    };
    g.qty += Number(l.qty);
    g.revenue += revenue;
    agg.set(l.itemId, g);
  }
  const sorted = [...agg.values()].sort((a, b) => b.revenue - a.revenue);
  const total = sorted.reduce((s, r) => s + r.revenue, 0);
  let cum = 0;
  const rows = sorted.map((r) => {
    cum += r.revenue;
    const cumPct = total > 0 ? (cum / total) * 100 : 0;
    const clazz = cumPct <= 80 ? "A" : cumPct <= 95 ? "B" : "C";
    return {
      ...r,
      cumulativePct: Math.round(cumPct * 100) / 100,
      abcClass: clazz,
    };
  });
  res.json({
    rows,
    totalRevenue: total,
    from: from.toISOString(),
    to: to.toISOString(),
  });
});

// Stock Ledger: raw SLE history for an (item, warehouse) pair.
stockReportsRouter.get("/stock-ledger", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const itemId = typeof req.query.itemId === "string" ? req.query.itemId : null;
  const warehouseId =
    typeof req.query.warehouseId === "string" ? req.query.warehouseId : null;
  if (!itemId || !warehouseId)
    return res.status(400).json({ error: "itemId and warehouseId are required" });

  const rows = await prisma.stockLedgerEntry.findMany({
    where: { tenantId, itemId, warehouseId, isCancelled: false },
    orderBy: { postingDate: "asc" },
  });
  res.json(rows);
});
