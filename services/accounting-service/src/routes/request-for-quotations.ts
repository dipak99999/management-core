import { Router } from "express";
import { z } from "zod";
import { Prisma, nextName, prisma } from "@lumaara/db";
import { idempotency, perms } from "@lumaara/service-auth";

// Module 45 — Request for Quotation.
//
// Buying's pre-PO negotiation phase:
//   Buyer creates an RFQ with the items they need + invites N suppliers.
//   Each supplier files a SupplierQuotation (SQ) with rate + optional
//   lead time. Buyer compares quotes, awards the winner, which
//   auto-creates a PurchaseOrder against the winning quote.
//
// Lifecycle: Draft → Submitted → Awarded | Cancelled.

export const rfqRouter = Router();
const p = perms("PurchaseOrder"); // reuse the buying perm surface

const rfqItemSchema = z.object({
  itemId: z.string().min(1),
  qty: z.coerce.number().positive(),
  materialRequestItemId: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
});

const rfqSupplierSchema = z.object({
  supplierId: z.string().min(1),
});

const upsertSchema = z.object({
  transactionDate: z.string().datetime().optional(),
  responseDueDate: z.string().datetime().optional().nullable(),
  message: z.string().max(2000).optional().nullable(),
  suppliers: z.array(rfqSupplierSchema).min(1),
  items: z.array(rfqItemSchema).min(1),
});

rfqRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.requestForQuotation.findMany({
    where: { tenantId: req.auth!.tenantId },
    include: {
      suppliers: { include: { supplier: { select: { supplierName: true } } } },
      items: true,
      _count: { select: { quotations: true } },
    },
    orderBy: { transactionDate: "desc" },
  });
  res.json(rows);
});

rfqRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.requestForQuotation.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      items: { include: { item: { select: { itemCode: true, itemName: true } } } },
      suppliers: { include: { supplier: true } },
      quotations: {
        include: {
          supplier: { select: { supplierName: true } },
          items: true,
        },
        orderBy: { transactionDate: "asc" },
      },
      awardedSupplierQuotation: {
        include: { supplier: { select: { supplierName: true } } },
      },
      awardedPurchaseOrder: {
        select: { id: true, name: true, status: true, grandTotal: true },
      },
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

// Compare-quotes payload: side-by-side supplier bids per RFQ item.
// Powers the compare UI so the buyer can see who's cheapest per line
// and who's fastest, and how the totals stack up.
rfqRouter.get("/:id/compare", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const rfq = await prisma.requestForQuotation.findFirst({
    where: { id: req.params.id, tenantId },
    include: {
      items: { include: { item: { select: { itemCode: true, itemName: true } } } },
      quotations: {
        where: { status: { in: ["Submitted", "Awarded"] } },
        include: {
          supplier: { select: { supplierName: true } },
          items: true,
        },
      },
    },
  });
  if (!rfq) return res.status(404).json({ error: "Not found" });

  // Build a per-item map: { rfqItemId → [{ quotationId, supplier, rate, leadTimeDays }] }.
  const byRfqItem = new Map<
    string,
    Array<{
      quotationId: string;
      quotationName: string;
      supplierName: string;
      rate: number;
      amount: number;
      leadTimeDays: number | null;
    }>
  >();
  for (const q of rfq.quotations) {
    for (const line of q.items) {
      const arr = byRfqItem.get(line.rfqItemId) ?? [];
      arr.push({
        quotationId: q.id,
        quotationName: q.name,
        supplierName: q.supplier.supplierName,
        rate: Number(line.rate),
        amount: Number(line.amount),
        leadTimeDays: line.leadTimeDays,
      });
      byRfqItem.set(line.rfqItemId, arr);
    }
  }
  // For each RFQ item, sort quotes by rate asc so the UI can highlight
  // the cheapest at a glance.
  for (const arr of byRfqItem.values()) arr.sort((a, b) => a.rate - b.rate);

  // Per-supplier totals across all lines they quoted. Includes the
  // scorecard's cached latest score + standing so the compare UI can
  // help buyers make quality-adjusted decisions (Module 46).
  const supplierIds = [...new Set(rfq.quotations.map((q) => q.supplierId))];
  const scorecards = supplierIds.length
    ? await prisma.supplierScorecard.findMany({
        where: { tenantId, supplierId: { in: supplierIds } },
        select: {
          supplierId: true,
          latestScore: true,
          latestStanding: true,
          latestScoredAsOf: true,
        },
      })
    : [];
  const scoreBySupplier = new Map(scorecards.map((s) => [s.supplierId, s]));

  const totalsBySupplier = new Map<
    string,
    {
      quotationId: string;
      supplierName: string;
      netTotal: number;
      itemsQuoted: number;
      supplierScore: number | null;
      supplierStanding: string | null;
      supplierScoredAsOf: Date | null;
    }
  >();
  for (const q of rfq.quotations) {
    const sc = scoreBySupplier.get(q.supplierId);
    totalsBySupplier.set(q.id, {
      quotationId: q.id,
      supplierName: q.supplier.supplierName,
      netTotal: Number(q.netTotal),
      itemsQuoted: q.items.length,
      supplierScore: sc?.latestScore ? Number(sc.latestScore) : null,
      supplierStanding: sc?.latestStanding ?? null,
      supplierScoredAsOf: sc?.latestScoredAsOf ?? null,
    });
  }

  res.json({
    rfq: {
      id: rfq.id,
      name: rfq.name,
      status: rfq.status,
      transactionDate: rfq.transactionDate,
      responseDueDate: rfq.responseDueDate,
      awardedSupplierQuotationId: rfq.awardedSupplierQuotationId,
      awardedPurchaseOrderId: rfq.awardedPurchaseOrderId,
    },
    items: rfq.items.map((i) => ({
      rfqItemId: i.id,
      itemCode: i.item.itemCode,
      itemName: i.item.itemName,
      qty: Number(i.qty),
      quotes: byRfqItem.get(i.id) ?? [],
    })),
    totals: [...totalsBySupplier.values()].sort((a, b) => a.netTotal - b.netTotal),
  });
});

rfqRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;
  const tenantId = req.auth!.tenantId;

  // Validate suppliers all belong to this tenant + not disabled.
  const supplierIds = Array.from(new Set(b.suppliers.map((s) => s.supplierId)));
  const suppliers = await prisma.supplier.findMany({
    where: { id: { in: supplierIds }, tenantId },
    select: { id: true, supplierName: true },
  });
  if (suppliers.length !== supplierIds.length) {
    return res.status(400).json({ error: "One or more suppliers do not belong to this tenant" });
  }

  // Validate item ids.
  const itemIds = Array.from(new Set(b.items.map((i) => i.itemId)));
  const items = await prisma.item.count({ where: { id: { in: itemIds }, tenantId } });
  if (items !== itemIds.length) {
    return res.status(400).json({ error: "One or more items do not belong to this tenant" });
  }

  const name = await nextName(prisma, tenantId, "RFQ-");
  const supplierNameById = new Map(suppliers.map((s) => [s.id, s.supplierName]));
  const row = await prisma.requestForQuotation.create({
    data: {
      tenantId,
      name,
      transactionDate: b.transactionDate ? new Date(b.transactionDate) : new Date(),
      responseDueDate: b.responseDueDate ? new Date(b.responseDueDate) : null,
      message: b.message ?? null,
      status: "Draft",
      items: {
        create: b.items.map((i) => ({
          itemId: i.itemId,
          qty: new Prisma.Decimal(i.qty),
          materialRequestItemId: i.materialRequestItemId ?? null,
          description: i.description ?? null,
        })),
      },
      suppliers: {
        create: supplierIds.map((sid) => ({
          supplierId: sid,
          supplierName: supplierNameById.get(sid)!,
        })),
      },
    },
    include: { items: true, suppliers: true },
  });
  res.status(201).json(row);
});

// Simple submit: flip status → Submitted. Actual email dispatch is a
// future concern (portal-web supplier link).
rfqRouter.post("/:id/submit", p.submit, idempotency("POST /request-for-quotations/:id/submit"), async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const row = await prisma.requestForQuotation.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  if (row.status !== "Draft")
    return res.status(400).json({ error: `Cannot submit RFQ in status ${row.status}` });
  const updated = await prisma.requestForQuotation.update({
    where: { id: row.id },
    data: { status: "Submitted" },
  });
  res.json(updated);
});

// Award: pick a SupplierQuotation to win the RFQ + auto-create a PO
// from that quote's lines. Transactional so partial failures roll back.
rfqRouter.post("/:id/award", p.submit, async (req, res) => {
  const parsed = z.object({ supplierQuotationId: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;

  const rfq = await prisma.requestForQuotation.findFirst({
    where: { id: req.params.id, tenantId },
    include: { items: true },
  });
  if (!rfq) return res.status(404).json({ error: "RFQ not found" });
  if (rfq.status === "Cancelled") return res.status(400).json({ error: "RFQ is cancelled" });
  if (rfq.status === "Awarded") return res.status(400).json({ error: "RFQ already awarded" });

  const sq = await prisma.supplierQuotation.findFirst({
    where: { id: parsed.data.supplierQuotationId, tenantId, rfqId: rfq.id },
    include: { items: true },
  });
  if (!sq) return res.status(400).json({ error: "Supplier quotation not found for this RFQ" });
  if (sq.status !== "Submitted")
    return res.status(400).json({ error: `Cannot award SQ in status ${sq.status}` });

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Build PO lines from the SQ items. Preserves the RFQ MR
      // backlink so downstream MR.orderedQty accounting still works.
      const rfqItemById = new Map(rfq.items.map((i) => [i.id, i]));
      const poLines = sq.items.map((line) => {
        const rfqLine = rfqItemById.get(line.rfqItemId);
        return {
          itemId: line.itemId,
          qty: line.qty,
          rate: line.rate,
          amount: line.amount,
          materialRequestItemId: rfqLine?.materialRequestItemId ?? null,
        };
      });
      const netTotal = poLines.reduce((s, l) => s.add(l.amount), new Prisma.Decimal(0));

      const poName = await nextName(tx, tenantId, "PO-");
      const po = await tx.purchaseOrder.create({
        data: {
          tenantId,
          name: poName,
          supplierId: sq.supplierId,
          transactionDate: new Date(),
          currency: sq.currency,
          conversionRate: sq.conversionRate,
          netTotal,
          grandTotal: netTotal, // no tax snapshot on the auto-PO — buyer can edit if needed
          status: "Draft",
          remarks: `Awarded from ${rfq.name} · ${sq.name}`,
          items: { create: poLines },
        },
      });

      await tx.supplierQuotation.update({
        where: { id: sq.id },
        data: { status: "Awarded" },
      });
      // Every other SQ under this RFQ is soft-rejected.
      await tx.supplierQuotation.updateMany({
        where: { tenantId, rfqId: rfq.id, status: "Submitted", NOT: { id: sq.id } },
        data: { status: "Rejected" },
      });
      const updated = await tx.requestForQuotation.update({
        where: { id: rfq.id },
        data: {
          status: "Awarded",
          awardedSupplierQuotationId: sq.id,
          awardedPurchaseOrderId: po.id,
        },
      });
      return { rfq: updated, purchaseOrder: po };
    });
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(400).json({ error: msg });
  }
});

rfqRouter.post("/:id/cancel", p.cancel, idempotency("POST /request-for-quotations/:id/cancel"), async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const row = await prisma.requestForQuotation.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  if (row.status === "Cancelled") return res.status(400).json({ error: "Already cancelled" });
  if (row.status === "Awarded") {
    return res.status(400).json({
      error: "Cannot cancel an awarded RFQ. Cancel the linked PO first if needed.",
    });
  }
  const updated = await prisma.requestForQuotation.update({
    where: { id: row.id },
    data: { status: "Cancelled" },
  });
  res.json(updated);
});
