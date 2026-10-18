import { Router } from "express";
import { z } from "zod";
import { Prisma, prisma, nextName } from "@lumaara/db";
import { idempotency, perms, publishRealtime } from "@lumaara/service-auth";

// D11: Subscription — auto-generate Draft SalesInvoices on a schedule.
// Frequency options: Weekly, Monthly, Quarterly, Yearly. The generator
// walks nextGenerationDate forward one period at a time, minting a Draft
// SI per period until either nextGenerationDate > today or an endDate cap
// is reached.

export const subscriptionRouter = Router();

const p = perms("Subscription");

const itemLineSchema = z.object({
  itemId: z.string().min(1),
  qty: z.coerce.number().positive(),
  rate: z.coerce.number().nonnegative(),
});

const upsertSchema = z.object({
  customerId: z.string().min(1),
  frequency: z.enum(["Weekly", "Monthly", "Quarterly", "Yearly"]).default("Monthly"),
  startDate: z.string().datetime(),
  endDate: z.string().datetime().optional().nullable(),
  nextGenerationDate: z.string().datetime().optional(),
  currency: z.string().default("INR"),
  taxTemplateId: z.string().optional().nullable(),
  autoSubmit: z.boolean().default(false),
  remarks: z.string().optional().nullable(),
  items: z.array(itemLineSchema).min(1),
});

function advanceDate(from: Date, frequency: string): Date {
  const d = new Date(from);
  switch (frequency) {
    case "Weekly":
      d.setDate(d.getDate() + 7);
      break;
    case "Quarterly":
      d.setMonth(d.getMonth() + 3);
      break;
    case "Yearly":
      d.setFullYear(d.getFullYear() + 1);
      break;
    case "Monthly":
    default:
      d.setMonth(d.getMonth() + 1);
  }
  return d;
}

subscriptionRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.subscription.findMany({
    where: { tenantId: req.auth!.tenantId },
    include: {
      customer: { select: { customerName: true } },
      items: true,
    },
    orderBy: { nextGenerationDate: "asc" },
  });
  res.json(rows);
});

subscriptionRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.subscription.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      customer: true,
      items: { include: { item: { select: { itemCode: true, itemName: true, stockUom: true } } } },
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

subscriptionRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const cust = await prisma.customer.findFirst({
    where: { id: parsed.data.customerId, tenantId },
  });
  if (!cust) return res.status(400).json({ error: "Invalid customer" });
  const name = await nextName(prisma, tenantId, "SUB-");
  const row = await prisma.subscription.create({
    data: {
      tenantId,
      name,
      customerId: parsed.data.customerId,
      frequency: parsed.data.frequency,
      startDate: new Date(parsed.data.startDate),
      endDate: parsed.data.endDate ? new Date(parsed.data.endDate) : null,
      nextGenerationDate: new Date(parsed.data.nextGenerationDate ?? parsed.data.startDate),
      currency: parsed.data.currency,
      taxTemplateId: parsed.data.taxTemplateId ?? null,
      autoSubmit: parsed.data.autoSubmit,
      remarks: parsed.data.remarks ?? null,
      status: "Active",
      items: {
        create: parsed.data.items.map((i) => ({
          itemId: i.itemId,
          qty: new Prisma.Decimal(i.qty),
          rate: new Prisma.Decimal(i.rate),
        })),
      },
    },
    include: { items: true },
  });
  res.status(201).json(row);
});

subscriptionRouter.put("/:id", p.write, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.subscription.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const updated = await prisma.$transaction(async (tx) => {
    await tx.subscriptionItem.deleteMany({ where: { subscriptionId: existing.id } });
    return tx.subscription.update({
      where: { id: existing.id },
      data: {
        customerId: parsed.data.customerId,
        frequency: parsed.data.frequency,
        startDate: new Date(parsed.data.startDate),
        endDate: parsed.data.endDate ? new Date(parsed.data.endDate) : null,
        nextGenerationDate: new Date(
          parsed.data.nextGenerationDate ?? existing.nextGenerationDate,
        ),
        currency: parsed.data.currency,
        taxTemplateId: parsed.data.taxTemplateId ?? null,
        autoSubmit: parsed.data.autoSubmit,
        remarks: parsed.data.remarks ?? null,
        items: {
          create: parsed.data.items.map((i) => ({
            itemId: i.itemId,
            qty: new Prisma.Decimal(i.qty),
            rate: new Prisma.Decimal(i.rate),
          })),
        },
      },
      include: { items: true },
    });
  });
  res.json(updated);
});

subscriptionRouter.post("/:id/pause", p.write, async (req, res) => {
  const row = await prisma.subscription.update({
    where: { id: req.params.id },
    data: { status: "Paused" },
  });
  void publishRealtime(req.auth!.tenantId, "subscription", { id: row.id, status: "Paused" });
  res.json(row);
});
subscriptionRouter.post("/:id/resume", p.write, async (req, res) => {
  const row = await prisma.subscription.update({
    where: { id: req.params.id },
    data: { status: "Active" },
  });
  void publishRealtime(req.auth!.tenantId, "subscription", { id: row.id, status: "Active" });
  res.json(row);
});
subscriptionRouter.post("/:id/cancel", p.cancel, idempotency("POST /subscriptions/:id/cancel"), async (req, res) => {
  const row = await prisma.subscription.update({
    where: { id: req.params.id },
    data: { status: "Cancelled" },
  });
  void publishRealtime(req.auth!.tenantId, "subscription", { id: row.id, status: "Cancelled" });
  res.json(row);
});

// D11: generate — mint Draft SIs for every due period, advancing
// nextGenerationDate. Bounded loop (max 24 iterations per call) so a stale
// subscription that hasn't been generated in a year doesn't lock the tx.
async function generateForOne(
  tenantId: string,
  subId: string,
): Promise<{ generated: number; invoices: string[]; nextDate: Date }> {
  return prisma.$transaction(async (tx) => {
    const sub = await tx.subscription.findFirst({
      where: { id: subId, tenantId, status: "Active" },
      include: { items: true },
    });
    if (!sub) throw new Error("Not found or inactive");
    const today = new Date();
    const invoiceIds: string[] = [];
    let next = sub.nextGenerationDate;
    let steps = 0;
    while (
      next <= today &&
      (!sub.endDate || next <= sub.endDate) &&
      steps < 24
    ) {
      const netTotal = sub.items.reduce(
        (s, l) => s.add(new Prisma.Decimal(l.qty).mul(l.rate)),
        new Prisma.Decimal(0),
      );
      const name = await nextName(tx, tenantId, "SINV-");
      const inv = await tx.salesInvoice.create({
        data: {
          tenantId,
          name,
          customerId: sub.customerId,
          postingDate: next,
          currency: sub.currency,
          conversionRate: new Prisma.Decimal(1),
          taxTemplateId: sub.taxTemplateId ?? null,
          netTotal,
          totalTaxes: new Prisma.Decimal(0),
          grandTotal: netTotal,
          roundedTotal: netTotal,
          roundingAdjustment: new Prisma.Decimal(0),
          outstandingAmt: netTotal,
          status: "Draft",
          remarks: `Auto-generated from ${sub.name}`,
          items: {
            create: sub.items.map((l) => ({
              itemId: l.itemId,
              qty: l.qty,
              rate: l.rate,
              amount: new Prisma.Decimal(l.qty).mul(l.rate),
            })),
          },
        },
        select: { id: true, name: true },
      });
      invoiceIds.push(inv.name);
      next = advanceDate(next, sub.frequency);
      steps++;
    }
    const done = sub.endDate && next > sub.endDate;
    await tx.subscription.update({
      where: { id: sub.id },
      data: {
        nextGenerationDate: next,
        status: done ? "Completed" : sub.status,
      },
    });
    return { generated: invoiceIds.length, invoices: invoiceIds, nextDate: next };
  });
}

subscriptionRouter.post("/:id/generate", p.submit, async (req, res) => {
  try {
    const result = await generateForOne(req.auth!.tenantId, req.params.id);
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(msg === "Not found or inactive" ? 404 : 400).json({ error: msg });
  }
});

// Batch: run every Active subscription whose nextGenerationDate <= today.
// Meant for a nightly cron.
subscriptionRouter.post("/generate-due", p.submit, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const today = new Date();
  const due = await prisma.subscription.findMany({
    where: { tenantId, status: "Active", nextGenerationDate: { lte: today } },
    select: { id: true },
  });
  const results: {
    id: string;
    generated: number;
    invoices: string[];
  }[] = [];
  for (const s of due) {
    try {
      const r = await generateForOne(tenantId, s.id);
      results.push({ id: s.id, generated: r.generated, invoices: r.invoices });
    } catch {
      // continue on per-sub failure
    }
  }
  res.json({
    subsProcessed: due.length,
    totalGenerated: results.reduce((s, r) => s + r.generated, 0),
    results,
  });
});
