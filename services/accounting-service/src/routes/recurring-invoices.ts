import { Router } from "express";
import { z } from "zod";
import { Prisma, prisma, nextName, previewUpcomingRuns } from "@lumaara/db";
import { perms, publishRealtime } from "@lumaara/service-auth";

// Recurring invoice — a template that the scheduler materialises into a real
// SalesInvoice on nextRunDate. This route exposes CRUD + a `generate` action
// that runs one cycle for a single template on demand (useful for manual
// early-firing or "regenerate this month's" flows).

export const recurringInvoiceRouter = Router();
const p = perms("SalesInvoice"); // reuse SI perms — recurring is just a template

// ── validation ────────────────────────────────────────────────────────

const FREQ = ["Daily", "Weekly", "Monthly", "Quarterly", "Yearly"] as const;

const itemSchema = z.object({
  itemId: z.string().min(1),
  qty:  z.number().positive(),
  rate: z.number().nonnegative(),
  description: z.string().nullable().optional(),
});

const createSchema = z.object({
  title: z.string().min(1),
  customerId: z.string().min(1),
  currency: z.string().default("INR"),
  taxTemplateId: z.string().nullable().optional(),
  remarks: z.string().nullable().optional(),
  frequency: z.enum(FREQ),
  intervalCount: z.number().int().positive().default(1),
  startDate: z.string().min(1),          // ISO date
  endDate: z.string().nullable().optional(),
  daysUntilDue: z.number().int().nonnegative().default(30),
  items: z.array(itemSchema).min(1),
});

const updateSchema = createSchema.partial().extend({
  status: z.enum(["Active", "Paused", "Ended"]).optional(),
});

// ── helpers ───────────────────────────────────────────────────────────

// Advance a date by one interval unit. Returns a new date at the start of
// the next period.
function advanceDate(from: Date, frequency: string, intervalCount: number): Date {
  const d = new Date(from);
  d.setUTCHours(0, 0, 0, 0);
  switch (frequency) {
    case "Daily":     d.setUTCDate(d.getUTCDate() + intervalCount); break;
    case "Weekly":    d.setUTCDate(d.getUTCDate() + intervalCount * 7); break;
    case "Monthly":   d.setUTCMonth(d.getUTCMonth() + intervalCount); break;
    case "Quarterly": d.setUTCMonth(d.getUTCMonth() + intervalCount * 3); break;
    case "Yearly":    d.setUTCFullYear(d.getUTCFullYear() + intervalCount); break;
  }
  return d;
}

function sumAmount(items: { qty: number; rate: number }[]): number {
  return items.reduce((s, i) => s + i.qty * i.rate, 0);
}

// Materialise one SalesInvoice from a template + advance the template's
// nextRunDate. Wrapped in a Prisma transaction so a failed SI create doesn't
// silently advance the schedule. Returns the created invoice id.
export async function generateOne(
  templateId: string,
  tenantId: string,
): Promise<{ invoiceId: string; nextRunDate: Date | null }> {
  return prisma.$transaction(async (tx) => {
    const t = await tx.recurringInvoice.findFirst({
      where: { id: templateId, tenantId },
      include: { items: true },
    });
    if (!t) throw new Error("Template not found");
    if (t.status !== "Active") throw new Error(`Template is ${t.status}`);

    const postingDate = new Date();
    const dueDate = new Date(postingDate);
    dueDate.setUTCDate(dueDate.getUTCDate() + t.daysUntilDue);

    const net = t.items.reduce(
      (s, i) => s.plus(new Prisma.Decimal(i.amount)),
      new Prisma.Decimal(0),
    );

    const siName = await nextName(tx, tenantId, "SINV-");
    const invoice = await tx.salesInvoice.create({
      data: {
        tenantId,
        name: siName,
        customerId: t.customerId,
        postingDate,
        dueDate,
        currency: t.currency,
        taxTemplateId: t.taxTemplateId,
        netTotal: net,
        grandTotal: net,
        outstandingAmt: net,
        status: "Draft",
        // Stamp the template id so the recurring detail page's history
        // table shows this SI. Same field the scheduler stamps.
        sourceRecurringId: t.id,
        remarks: t.remarks
          ? `${t.remarks}\n\n(auto-generated from recurring "${t.title}")`
          : `Auto-generated from recurring "${t.title}"`,
        items: {
          create: t.items.map((it) => ({
            itemId: it.itemId,
            qty: it.qty,
            rate: it.rate,
            amount: it.amount,
            description: it.description,
          })),
        },
      },
    });

    // Compute the next tick — stop if we've reached endDate.
    const nextDate = advanceDate(t.nextRunDate, t.frequency, t.intervalCount);
    const done = t.endDate && nextDate > t.endDate;

    await tx.recurringInvoice.update({
      where: { id: t.id },
      data: {
        lastGeneratedAt: postingDate,
        generatedCount: { increment: 1 },
        nextRunDate: done ? t.nextRunDate : nextDate,
        status: done ? "Ended" : t.status,
      },
    });

    return { invoiceId: invoice.id, nextRunDate: done ? null : nextDate };
  });
}

// ── routes ────────────────────────────────────────────────────────────

recurringInvoiceRouter.get("/", p.read, async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const rows = await prisma.recurringInvoice.findMany({
    where: {
      tenantId: req.auth!.tenantId,
      ...(status ? { status } : {}),
    },
    include: {
      customer: { select: { id: true, customerName: true } },
      _count: { select: { items: true } },
    },
    orderBy: [{ status: "asc" }, { nextRunDate: "asc" }],
  });
  res.json(rows);
});

recurringInvoiceRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.recurringInvoice.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      customer: { select: { id: true, customerName: true } },
      items: { include: { item: { select: { itemCode: true, itemName: true } } } },
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

recurringInvoiceRouter.post("/", p.create, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid" });
  const data = parsed.data;

  const name = await nextName(prisma, req.auth!.tenantId, "RECINV-");
  const startDate = new Date(data.startDate);
  const row = await prisma.recurringInvoice.create({
    data: {
      tenantId: req.auth!.tenantId,
      name,
      title: data.title,
      customerId: data.customerId,
      currency: data.currency,
      taxTemplateId: data.taxTemplateId ?? null,
      remarks: data.remarks ?? null,
      frequency: data.frequency,
      intervalCount: data.intervalCount,
      startDate,
      endDate: data.endDate ? new Date(data.endDate) : null,
      daysUntilDue: data.daysUntilDue,
      nextRunDate: startDate,
      items: {
        create: data.items.map((it) => ({
          itemId: it.itemId,
          qty: new Prisma.Decimal(it.qty),
          rate: new Prisma.Decimal(it.rate),
          amount: new Prisma.Decimal(it.qty * it.rate),
          description: it.description ?? null,
        })),
      },
    },
    include: { items: true },
  });
  res.status(201).json(row);
});

recurringInvoiceRouter.put("/:id", p.write, async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid" });
  const data = parsed.data;

  const existing = await prisma.recurringInvoice.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });

  // If items are being edited, replace the child rows wholesale.
  const shouldReplaceItems = Array.isArray(data.items);

  const row = await prisma.$transaction(async (tx) => {
    if (shouldReplaceItems) {
      await tx.recurringInvoiceItem.deleteMany({ where: { recurringInvoiceId: existing.id } });
    }
    return tx.recurringInvoice.update({
      where: { id: existing.id },
      data: {
        title: data.title ?? existing.title,
        customerId: data.customerId ?? existing.customerId,
        currency: data.currency ?? existing.currency,
        taxTemplateId: data.taxTemplateId === undefined ? existing.taxTemplateId : data.taxTemplateId,
        remarks: data.remarks === undefined ? existing.remarks : data.remarks,
        frequency: data.frequency ?? existing.frequency,
        intervalCount: data.intervalCount ?? existing.intervalCount,
        startDate: data.startDate ? new Date(data.startDate) : existing.startDate,
        endDate: data.endDate === undefined
          ? existing.endDate
          : data.endDate === null ? null : new Date(data.endDate),
        daysUntilDue: data.daysUntilDue ?? existing.daysUntilDue,
        status: data.status ?? existing.status,
        ...(shouldReplaceItems && {
          items: {
            create: data.items!.map((it) => ({
              itemId: it.itemId,
              qty: new Prisma.Decimal(it.qty),
              rate: new Prisma.Decimal(it.rate),
              amount: new Prisma.Decimal(it.qty * it.rate),
              description: it.description ?? null,
            })),
          },
        }),
      },
      include: { items: true },
    });
  });
  res.json(row);
});

recurringInvoiceRouter.delete("/:id", p.delete, async (req, res) => {
  const existing = await prisma.recurringInvoice.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.recurringInvoice.delete({ where: { id: existing.id } });
  res.status(204).end();
});

// Manual trigger — generate one invoice from this template now, regardless
// of nextRunDate. Advances the schedule as if the tick had fired.
recurringInvoiceRouter.post("/:id/generate-now", p.write, async (req, res) => {
  try {
    const out = await generateOne(req.params.id, req.auth!.tenantId);
    res.json({ ok: true, ...out });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
  }
});

// Pause / resume shortcuts — plain PUT status also works, but named endpoints
// read better in audit logs.
recurringInvoiceRouter.post("/:id/pause", p.write, async (req, res) => {
  const row = await prisma.recurringInvoice.updateMany({
    where: { id: req.params.id, tenantId: req.auth!.tenantId, status: "Active" },
    data: { status: "Paused" },
  });
  if (row.count > 0) {
    void publishRealtime(req.auth!.tenantId, "recurring-invoice", { id: req.params.id, status: "Paused" });
  }
  res.json({ ok: true, updated: row.count });
});
recurringInvoiceRouter.post("/:id/resume", p.write, async (req, res) => {
  const row = await prisma.recurringInvoice.updateMany({
    where: { id: req.params.id, tenantId: req.auth!.tenantId, status: "Paused" },
    data: { status: "Active" },
  });
  if (row.count > 0) {
    void publishRealtime(req.auth!.tenantId, "recurring-invoice", { id: req.params.id, status: "Active" });
  }
  res.json({ ok: true, updated: row.count });
});

// ---------- History + upcoming preview (for the detail page) ----------

// GET /:id/history — every SalesInvoice this template has generated,
// ordered newest first with a compact projection for the history table.
recurringInvoiceRouter.get("/:id/history", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const template = await prisma.recurringInvoice.findFirst({
    where: { id: req.params.id, tenantId },
    select: { id: true },
  });
  if (!template) return res.status(404).json({ error: "Not found" });
  const rows = await prisma.salesInvoice.findMany({
    where: { tenantId, sourceRecurringId: template.id },
    select: {
      id: true,
      name: true,
      postingDate: true,
      dueDate: true,
      status: true,
      grandTotal: true,
      outstandingAmt: true,
      currency: true,
    },
    orderBy: { postingDate: "desc" },
    take: 200,
  });
  res.json(rows);
});

// GET /:id/upcoming?count=6 — preview the next N run dates using the
// pure previewUpcomingRuns helper. Skips DB work when the template is
// Ended (no future runs).
recurringInvoiceRouter.get("/:id/upcoming", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const count = Math.max(1, Math.min(24, Number(req.query.count ?? 6)));
  const t = await prisma.recurringInvoice.findFirst({
    where: { id: req.params.id, tenantId },
    select: {
      status: true,
      frequency: true,
      intervalCount: true,
      nextRunDate: true,
      endDate: true,
    },
  });
  if (!t) return res.status(404).json({ error: "Not found" });
  if (t.status === "Ended") return res.json([]);
  const runs = previewUpcomingRuns({
    frequency: t.frequency as import("@lumaara/db").Frequency,
    intervalCount: t.intervalCount,
    nextRunDate: t.nextRunDate,
    endDate: t.endDate,
    count,
  });
  res.json(runs.map((d) => d.toISOString().slice(0, 10)));
});

// Called by the scheduler tick: run every Active template whose nextRunDate
// is on or before today. Returns a summary the scheduler can log.
export async function runRecurringInvoiceTick(): Promise<{
  templatesChecked: number;
  invoicesCreated: number;
  errors: number;
}> {
  const today = new Date();
  today.setUTCHours(23, 59, 59, 999);

  const due = await prisma.recurringInvoice.findMany({
    where: { status: "Active", nextRunDate: { lte: today } },
    select: { id: true, tenantId: true },
  });

  let created = 0;
  let errors = 0;
  for (const t of due) {
    try {
      // A template might be past-due by several ticks (server was offline);
      // catch up by generating repeatedly until nextRunDate is future.
      let safety = 24;
      while (safety-- > 0) {
        const fresh = await prisma.recurringInvoice.findUnique({
          where: { id: t.id },
          select: { status: true, nextRunDate: true },
        });
        if (!fresh || fresh.status !== "Active") break;
        if (fresh.nextRunDate > today) break;
        await generateOne(t.id, t.tenantId);
        created++;
      }
    } catch {
      errors++;
    }
  }

  return { templatesChecked: due.length, invoicesCreated: created, errors };
}
