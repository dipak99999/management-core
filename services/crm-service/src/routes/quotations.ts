import { Router } from "express";
import { z } from "zod";
import {
  Prisma,
  appendOppNote,
  computeTaxLines,
  emitEvent,
  nextName,
  nextOppStatusForQuoteEvent,
  prisma,
  resolveTaxTemplate,
  validateCustomData,
  type OpportunityStatus,
} from "@lumaara/db";
import { idempotency, perms, publishRealtime } from "@lumaara/service-auth";

export const quotationRouter = Router();

const p = perms("Quotation");

const itemLineSchema = z.object({
  itemId: z.string().min(1),
  qty: z.coerce.number().positive(),
  rate: z.coerce.number().nonnegative(),
  description: z.string().optional().nullable(),
});

const createSchema = z
  .object({
    partyType: z.enum(["Lead", "Customer"]),
    leadId: z.string().optional().nullable(),
    customerId: z.string().optional().nullable(),
    quotationDate: z.string().datetime().optional(),
    validTill: z.string().datetime().optional().nullable(),
    currency: z.string().default("INR"),
    taxTemplateId: z.string().optional().nullable(),
    remarks: z.string().optional().nullable(),
    // D9: follow-up date on the Draft/Submitted quote.
    nextFollowUpDate: z.string().datetime().optional().nullable(),
    items: z.array(itemLineSchema).min(1),
    customData: z.record(z.unknown()).optional().nullable(),
  })
  .refine(
    (p) =>
      (p.partyType === "Lead" && p.leadId && !p.customerId) ||
      (p.partyType === "Customer" && p.customerId && !p.leadId),
    { message: "partyType must match exactly one of leadId/customerId" },
  );

quotationRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.quotation.findMany({
    where: { tenantId: req.auth!.tenantId },
    include: {
      lead: { select: { name: true, leadName: true } },
      customer: { select: { customerName: true } },
      items: { include: { item: { select: { itemCode: true, itemName: true } } } },
    },
    orderBy: { quotationDate: "desc" },
  });
  res.json(rows);
});

quotationRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.quotation.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: { lead: true, customer: true, items: { include: { item: true } } },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

// Full detail: quotation + items + any Sales Orders converted from it.
quotationRouter.get("/:id/full", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;

  const q = await prisma.quotation.findFirst({
    where: { id: req.params.id, tenantId },
    include: {
      lead: true,
      customer: true,
      items: { include: { item: true } },
    },
  });
  if (!q) return res.status(404).json({ error: "Not found" });

  const salesOrders = await prisma.salesOrder.findMany({
    where: { tenantId, quotationId: q.id },
    select: {
      id: true,
      name: true,
      status: true,
      orderDate: true,
      grandTotal: true,
      invoicedAmount: true,
    },
    orderBy: { orderDate: "desc" },
  });

  res.json({ quotation: q, salesOrders });
});

// Update a Draft quotation. Wipes items and recreates. Post-submit edits
// blocked (would break any downstream Sales Order that references this quote).
quotationRouter.put("/:id", p.write, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const p = parsed.data;
  const tenantId = req.auth!.tenantId;

  const existing = await prisma.quotation.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.status !== "Draft")
    return res
      .status(400)
      .json({ error: `Cannot edit quotation in status ${existing.status}` });

  let customData;
  try {
    customData = await validateCustomData(
      prisma,
      tenantId,
      "Quotation",
      (p.customData as Record<string, unknown> | undefined) ?? undefined,
      { docId: existing.id },
    );
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
  }

  if (p.leadId) {
    const lead = await prisma.lead.findFirst({ where: { id: p.leadId, tenantId } });
    if (!lead) return res.status(400).json({ error: "Invalid lead" });
  }
  if (p.customerId) {
    const c = await prisma.customer.findFirst({ where: { id: p.customerId, tenantId } });
    if (!c) return res.status(400).json({ error: "Invalid customer" });
  }
  const itemIds = p.items.map((i) => i.itemId);
  const validItems = await prisma.item.findMany({
    where: { id: { in: itemIds }, tenantId },
    select: { id: true },
  });
  if (validItems.length !== new Set(itemIds).size)
    return res.status(400).json({ error: "One or more items are invalid" });

  const lines = p.items.map((i) => ({
    itemId: i.itemId,
    qty: new Prisma.Decimal(i.qty),
    rate: new Prisma.Decimal(i.rate),
    amount: new Prisma.Decimal(i.qty).mul(new Prisma.Decimal(i.rate)),
    description: i.description ?? null,
  }));
  const netTotal = lines.reduce((s, l) => s.add(l.amount), new Prisma.Decimal(0));

  let tax: Awaited<ReturnType<typeof resolveTaxTemplate>> = null;
  try {
    tax = await resolveTaxTemplate(prisma, tenantId, p.taxTemplateId, "Sales");
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
  }
  const taxLines = computeTaxLines(netTotal, tax?.rows ?? []);
  const totalTaxes = taxLines.reduce(
    (s, l) => s.add(l.taxAmount),
    new Prisma.Decimal(0),
  );
  const grandTotal = netTotal.add(totalTaxes);

  const updated = await prisma.$transaction(async (tx) => {
    await tx.quotationItem.deleteMany({ where: { quotationId: existing.id } });
    await tx.quotationTax.deleteMany({ where: { quotationId: existing.id } });
    return tx.quotation.update({
      where: { id: existing.id },
      data: {
        partyType: p.partyType,
        leadId: p.leadId ?? null,
        customerId: p.customerId ?? null,
        quotationDate: p.quotationDate ? new Date(p.quotationDate) : existing.quotationDate,
        validTill: p.validTill ? new Date(p.validTill) : null,
        currency: p.currency,
        taxTemplateId: tax?.id ?? null,
        remarks: p.remarks ?? null,
        nextFollowUpDate: p.nextFollowUpDate ? new Date(p.nextFollowUpDate) : null,
        netTotal,
        totalTaxes,
        grandTotal,
        customData: customData ?? undefined,
        items: { create: lines },
        taxes: taxLines.length
          ? {
              create: taxLines.map((r) => ({
                description: r.description,
                rate: r.rate,
                taxAmount: r.taxAmount,
                accountId: r.accountId,
                chargeType: r.chargeType,
                taxTemplateId: tax!.id,
              })),
            }
          : undefined,
      },
      include: { items: true, taxes: true },
    });
  });
  res.json(updated);
});

quotationRouter.post("/", p.create, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const p = parsed.data;
  const tenantId = req.auth!.tenantId;

  let customData;
  try {
    customData = await validateCustomData(
      prisma,
      tenantId,
      "Quotation",
      (p.customData as Record<string, unknown> | undefined) ?? undefined,
    );
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
  }

  if (p.leadId) {
    const lead = await prisma.lead.findFirst({ where: { id: p.leadId, tenantId } });
    if (!lead) return res.status(400).json({ error: "Invalid lead" });
  }
  if (p.customerId) {
    const c = await prisma.customer.findFirst({ where: { id: p.customerId, tenantId } });
    if (!c) return res.status(400).json({ error: "Invalid customer" });
  }
  const itemIds = p.items.map((i) => i.itemId);
  const validItems = await prisma.item.findMany({
    where: { id: { in: itemIds }, tenantId },
    select: { id: true },
  });
  if (validItems.length !== new Set(itemIds).size)
    return res.status(400).json({ error: "One or more items are invalid" });

  const lines = p.items.map((i) => ({
    itemId: i.itemId,
    qty: new Prisma.Decimal(i.qty),
    rate: new Prisma.Decimal(i.rate),
    amount: new Prisma.Decimal(i.qty).mul(new Prisma.Decimal(i.rate)),
    description: i.description ?? null,
  }));
  const netTotal = lines.reduce((s, l) => s.add(l.amount), new Prisma.Decimal(0));

  let tax: Awaited<ReturnType<typeof resolveTaxTemplate>> = null;
  try {
    tax = await resolveTaxTemplate(prisma, tenantId, p.taxTemplateId, "Sales");
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
  }
  const taxLines = computeTaxLines(netTotal, tax?.rows ?? []);
  const totalTaxes = taxLines.reduce(
    (s, l) => s.add(l.taxAmount),
    new Prisma.Decimal(0),
  );
  const grandTotal = netTotal.add(totalTaxes);

  const name = await nextName(prisma, tenantId, "QTN-");
  const row = await prisma.quotation.create({
    data: {
      tenantId,
      name,
      partyType: p.partyType,
      leadId: p.leadId ?? null,
      customerId: p.customerId ?? null,
      quotationDate: p.quotationDate ? new Date(p.quotationDate) : new Date(),
      validTill: p.validTill ? new Date(p.validTill) : null,
      currency: p.currency,
      taxTemplateId: tax?.id ?? null,
      remarks: p.remarks ?? null,
      nextFollowUpDate: p.nextFollowUpDate ? new Date(p.nextFollowUpDate) : null,
      netTotal,
      totalTaxes,
      grandTotal,
      status: "Draft",
      customData: customData ?? undefined,
      items: { create: lines },
      taxes: taxLines.length
        ? {
            create: taxLines.map((r) => ({
              description: r.description,
              rate: r.rate,
              taxAmount: r.taxAmount,
              accountId: r.accountId,
              chargeType: r.chargeType,
              taxTemplateId: tax!.id,
            })),
          }
        : undefined,
    },
    include: { items: true, taxes: true },
  });
  res.status(201).json(row);
});

quotationRouter.post("/:id/submit", p.submit, idempotency("POST /quotations/:id/submit"), async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const q = await prisma.quotation.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!q) return res.status(404).json({ error: "Not found" });
  if (q.status !== "Draft")
    return res.status(400).json({ error: `Cannot submit quotation in status ${q.status}` });
  const row = await prisma.quotation.update({
    where: { id: q.id },
    data: { status: "Submitted" },
  });
  void emitEvent(prisma, tenantId, "Quotation.submit", {
    id: row.id,
    name: row.name,
    partyType: row.partyType,
    customerId: row.customerId,
    leadId: row.leadId,
    grandTotal: Number(row.grandTotal),
    currency: row.currency,
  }).catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({
      level: "warn", kind: "emitEvent.failed", event: "Quotation.submit",
      tenantId, id: row.id,
      error: err instanceof Error ? err.message : String(err),
      time: new Date().toISOString(),
    }));
  });
  void publishRealtime(tenantId, "quotation", { id: row.id, status: "Submitted" });
  res.json(row);
});

quotationRouter.post("/:id/cancel", p.cancel, idempotency("POST /quotations/:id/cancel"), async (req, res) => {
  const q = await prisma.quotation.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!q) return res.status(404).json({ error: "Not found" });
  if (q.status === "Cancelled") return res.status(400).json({ error: "Already cancelled" });
  const row = await prisma.quotation.update({
    where: { id: q.id },
    data: { status: "Cancelled" },
  });
  void publishRealtime(req.auth!.tenantId, "quotation", { id: row.id, status: "Cancelled" });
  res.json(row);
});

// D9: mark-lost with a required reason. Only Submitted quotes are eligible
// (Draft can just be edited or cancelled; Ordered means already converted).
const markLostSchema = z.object({
  lostReason: z.string().min(1),
});
quotationRouter.post("/:id/mark-lost", p.submit, async (req, res) => {
  const parsed = markLostSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const q = await prisma.quotation.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!q) return res.status(404).json({ error: "Not found" });
  if (q.status !== "Submitted")
    return res
      .status(400)
      .json({ error: `Cannot mark lost in status ${q.status}` });
  // D15+: capture lostReason on the source Opportunity's remarks so
  // admins see WHY a quote failed without clicking through. We do NOT
  // flip opp.status to Lost — multiple opp-linked quotes can exist and
  // one losing doesn't kill the deal. Only the audit note is written.
  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.quotation.update({
      where: { id: q.id },
      data: { status: "Lost", lostReason: parsed.data.lostReason },
    });
    if (q.opportunityId) {
      const opp = await tx.opportunity.findFirst({
        where: { id: q.opportunityId, tenantId },
        select: { id: true, status: true, remarks: true },
      });
      if (opp) {
        const decision = nextOppStatusForQuoteEvent({
          currentStatus: opp.status as OpportunityStatus,
          event: "QuoteLost",
          quoteName: q.name,
          lostReason: parsed.data.lostReason,
        });
        // shouldUpdate is always false for QuoteLost, but we still write
        // the audit note into opp.remarks.
        await tx.opportunity.update({
          where: { id: opp.id },
          data: { remarks: appendOppNote(opp.remarks, decision.auditNote) },
        });
      }
    }
    return updated;
  });
  res.json(row);
});

// D9: expire stale quotes. Marks Submitted quotes whose validTill has
// passed as Expired. Safe to run repeatedly (idempotent). Meant to be
// called by a nightly cron; also exposed as a manual button.
quotationRouter.post("/expire-stale", p.submit, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const now = new Date();
  const result = await prisma.quotation.updateMany({
    where: {
      tenantId,
      status: "Submitted",
      validTill: { lt: now, not: null },
    },
    data: { status: "Expired" },
  });
  res.json({ expired: result.count });
});

// D9: follow-up report — Submitted quotes whose nextFollowUpDate is today
// or overdue. Optional `?withinDays=N` looks ahead.
quotationRouter.get("/reports/follow-ups", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const withinDays = req.query.withinDays ? Number(req.query.withinDays) : 0;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + withinDays);
  const rows = await prisma.quotation.findMany({
    where: {
      tenantId,
      status: "Submitted",
      nextFollowUpDate: { lte: cutoff, not: null },
    },
    include: {
      lead: { select: { leadName: true, companyName: true } },
      customer: { select: { customerName: true } },
    },
    orderBy: { nextFollowUpDate: "asc" },
  });
  res.json(rows);
});

// Convert Quotation → Sales Order. Requires the quotation is Submitted and
// tied to a Customer (not a Lead). If it's tied to a Lead, caller should
// convert the Lead first.
const convertSchema = z.object({
  deliveryDate: z.string().datetime().optional().nullable(),
});

quotationRouter.post("/:id/convert-to-sales-order", p.submit, perms("SalesOrder").create, async (req, res) => {
  const parsed = convertSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const q = await tx.quotation.findFirst({
        where: { id: req.params.id, tenantId },
        include: { items: true, taxes: true },
      });
      if (!q) throw new Error("Not found");
      if (q.status !== "Submitted")
        throw new Error(`Quotation must be Submitted (currently ${q.status})`);
      if (!q.customerId)
        throw new Error("Quotation is on a Lead — convert the Lead to Customer first");

      const soName = await nextName(tx, tenantId, "SO-");

      const so = await tx.salesOrder.create({
        data: {
          tenantId,
          name: soName,
          customerId: q.customerId,
          quotationId: q.id,
          orderDate: new Date(),
          deliveryDate: parsed.data.deliveryDate ? new Date(parsed.data.deliveryDate) : null,
          currency: q.currency,
          netTotal: q.netTotal,
          taxTemplateId: q.taxTemplateId,
          totalTaxes: q.totalTaxes,
          grandTotal: q.grandTotal,
          status: "Draft",
          items: {
            create: q.items.map((l) => ({
              itemId: l.itemId,
              qty: l.qty,
              rate: l.rate,
              amount: l.amount,
              description: l.description,
            })),
          },
          taxes: q.taxes.length
            ? {
                create: q.taxes.map((t) => ({
                  description: t.description,
                  rate: t.rate,
                  taxAmount: t.taxAmount,
                  accountId: t.accountId,
                  chargeType: t.chargeType,
                  taxTemplateId: t.taxTemplateId,
                })),
              }
            : undefined,
        },
        include: { items: true, taxes: true },
      });

      await tx.quotation.update({
        where: { id: q.id },
        data: { status: "Ordered" },
      });

      // D15+: propagate the win back to the source Opportunity (if any).
      // Advances Open/Quotation → Converted; no-op on Converted/Lost so
      // we never regress a decided opp.
      if (q.opportunityId) {
        const opp = await tx.opportunity.findFirst({
          where: { id: q.opportunityId, tenantId },
          select: { id: true, status: true, remarks: true },
        });
        if (opp) {
          const decision = nextOppStatusForQuoteEvent({
            currentStatus: opp.status as OpportunityStatus,
            event: "QuoteWon",
            quoteName: q.name,
          });
          if (decision.shouldUpdate) {
            await tx.opportunity.update({
              where: { id: opp.id },
              data: {
                status: decision.newStatus,
                remarks: appendOppNote(opp.remarks, decision.auditNote),
              },
            });
          }
        }
      }

      return so;
    });
    res.status(201).json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(msg === "Not found" ? 404 : 400).json({ error: msg });
  }
});
