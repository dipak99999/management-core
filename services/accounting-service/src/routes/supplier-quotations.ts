import { Router } from "express";
import { z } from "zod";
import { Prisma, nextName, prisma } from "@lumaara/db";
import { idempotency, perms } from "@lumaara/service-auth";

// Module 45 — Supplier Quotation.
//
// A supplier's response to an RFQ. In v1 we let buyers enter these on
// behalf of suppliers (phone/email-driven RFP flow); a future
// portal-web supplier login would let suppliers file their own quotes.
//
// Lifecycle: Draft → Submitted → Awarded | Rejected | Cancelled.
// Only the RFQ /:id/award endpoint flips a Submitted quote to Awarded;
// award simultaneously flips the RFQ's other Submitted quotes to
// Rejected (soft — kept for audit).

export const supplierQuotationRouter = Router();
const p = perms("PurchaseOrder");

const itemLineSchema = z.object({
  rfqItemId: z.string().min(1),
  qty: z.coerce.number().positive(),
  rate: z.coerce.number().nonnegative(),
  leadTimeDays: z.coerce.number().int().min(0).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

const upsertSchema = z.object({
  rfqId: z.string().min(1),
  supplierId: z.string().min(1),
  transactionDate: z.string().datetime().optional(),
  validTill: z.string().datetime().optional().nullable(),
  currency: z.string().default("INR"),
  conversionRate: z.coerce.number().positive().default(1),
  remarks: z.string().max(2000).optional().nullable(),
  items: z.array(itemLineSchema).min(1),
});

supplierQuotationRouter.get("/", p.read, async (req, res) => {
  // Optional ?rfqId= filter so the compare page can pull all quotes
  // for one RFQ in a single request.
  const where: Prisma.SupplierQuotationWhereInput = { tenantId: req.auth!.tenantId };
  if (typeof req.query.rfqId === "string" && req.query.rfqId.length > 0) {
    where.rfqId = req.query.rfqId;
  }
  const rows = await prisma.supplierQuotation.findMany({
    where,
    include: {
      supplier: { select: { supplierName: true } },
      rfq: { select: { name: true } },
      _count: { select: { items: true } },
    },
    orderBy: { transactionDate: "desc" },
  });
  res.json(rows);
});

supplierQuotationRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.supplierQuotation.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      supplier: true,
      rfq: { select: { id: true, name: true, status: true } },
      items: {
        include: {
          item: { select: { itemCode: true, itemName: true } },
          rfqItem: { select: { qty: true, itemId: true } },
        },
      },
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

supplierQuotationRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;
  const tenantId = req.auth!.tenantId;

  // Validate: RFQ belongs to tenant, is Submitted (not Draft or
  // Cancelled or Awarded), and supplier is an invited RFQSupplier.
  const rfq = await prisma.requestForQuotation.findFirst({
    where: { id: b.rfqId, tenantId },
    include: {
      items: { select: { id: true, itemId: true } },
      suppliers: { select: { supplierId: true } },
    },
  });
  if (!rfq) return res.status(400).json({ error: "RFQ not found" });
  if (rfq.status === "Cancelled" || rfq.status === "Awarded") {
    return res.status(400).json({ error: `Cannot file a quote against ${rfq.status} RFQ` });
  }
  if (!rfq.suppliers.some((s) => s.supplierId === b.supplierId)) {
    return res.status(400).json({ error: "Supplier is not invited to this RFQ" });
  }

  // Validate every line's rfqItemId belongs to this RFQ; derive itemId
  // from the RFQ line rather than trusting the payload (single source
  // of truth). Amount = qty × rate.
  const rfqItemById = new Map(rfq.items.map((i) => [i.id, i]));
  const lines = b.items.map((l) => {
    const rfqLine = rfqItemById.get(l.rfqItemId);
    if (!rfqLine) throw new Error(`rfqItemId ${l.rfqItemId} not part of this RFQ`);
    const qty = new Prisma.Decimal(l.qty);
    const rate = new Prisma.Decimal(l.rate);
    return {
      rfqItemId: l.rfqItemId,
      itemId: rfqLine.itemId,
      qty,
      rate,
      amount: qty.mul(rate),
      leadTimeDays: l.leadTimeDays ?? null,
      notes: l.notes ?? null,
    };
  });
  const netTotal = lines.reduce((s, l) => s.add(l.amount), new Prisma.Decimal(0));

  const name = await nextName(prisma, tenantId, "SQ-");
  try {
    const row = await prisma.$transaction(async (tx) => {
      const sq = await tx.supplierQuotation.create({
        data: {
          tenantId,
          name,
          rfqId: b.rfqId,
          supplierId: b.supplierId,
          transactionDate: b.transactionDate ? new Date(b.transactionDate) : new Date(),
          validTill: b.validTill ? new Date(b.validTill) : null,
          currency: b.currency,
          conversionRate: new Prisma.Decimal(b.conversionRate),
          netTotal,
          remarks: b.remarks ?? null,
          status: "Draft",
          items: { create: lines },
        },
        include: { items: true, supplier: { select: { supplierName: true } } },
      });
      // Flip the RFQSupplier response status so the RFQ list surfaces
      // that this supplier has quoted.
      await tx.rFQSupplier.updateMany({
        where: { rfqId: b.rfqId, supplierId: b.supplierId },
        data: { responseStatus: "Quoted", respondedAt: new Date() },
      });
      return sq;
    });
    res.status(201).json(row);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(400).json({ error: msg });
  }
});

supplierQuotationRouter.post("/:id/submit", p.submit, idempotency("POST /supplier-quotations/:id/submit"), async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const row = await prisma.supplierQuotation.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  if (row.status !== "Draft")
    return res.status(400).json({ error: `Cannot submit SQ in status ${row.status}` });
  const updated = await prisma.supplierQuotation.update({
    where: { id: row.id },
    data: { status: "Submitted" },
  });
  res.json(updated);
});

supplierQuotationRouter.post("/:id/cancel", p.cancel, idempotency("POST /supplier-quotations/:id/cancel"), async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const row = await prisma.supplierQuotation.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  if (row.status === "Awarded") {
    return res.status(400).json({
      error: "Cannot cancel an awarded quote. Cancel the linked PO first.",
    });
  }
  const updated = await prisma.supplierQuotation.update({
    where: { id: row.id },
    data: { status: "Cancelled" },
  });
  res.json(updated);
});
