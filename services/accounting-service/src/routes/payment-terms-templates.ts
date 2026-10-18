import { Router } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// D10: Payment Terms Templates. A template is a named list of due-date
// fractions (e.g. "50% net-30 / 50% net-60"). Wired into SalesInvoice
// and PurchaseInvoice: setting `paymentTermsTemplateId` on submit
// materializes InvoicePaymentSchedule rows and overwrites dueDate to
// the latest installment (see sales-invoices.ts / purchase-invoices.ts).

export const paymentTermsTemplateRouter = Router();

const p = perms("PaymentTermsTemplate");

const termSchema = z.object({
  description: z.string().min(1),
  invoicePortion: z.coerce.number().min(0).max(100),
  dueDays: z.coerce.number().int().nonnegative(),
  sortOrder: z.coerce.number().int().default(0),
});

const upsertSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional().nullable(),
    enabled: z.boolean().default(true),
    terms: z.array(termSchema).min(1),
  })
  .refine(
    (v) =>
      Math.abs(v.terms.reduce((s, t) => s + t.invoicePortion, 0) - 100) < 0.01,
    { message: "Term portions must sum to exactly 100%", path: ["terms"] },
  );

paymentTermsTemplateRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.paymentTermsTemplate.findMany({
    where: { tenantId: req.auth!.tenantId },
    include: { terms: { orderBy: { sortOrder: "asc" } } },
    orderBy: { name: "asc" },
  });
  res.json(rows);
});

paymentTermsTemplateRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.paymentTermsTemplate.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: { terms: { orderBy: { sortOrder: "asc" } } },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

paymentTermsTemplateRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const row = await prisma.paymentTermsTemplate.create({
      data: {
        tenantId: req.auth!.tenantId,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        enabled: parsed.data.enabled,
        terms: {
          create: parsed.data.terms.map((t, i) => ({
            description: t.description,
            invoicePortion: new Prisma.Decimal(t.invoicePortion),
            dueDays: t.dueDays,
            sortOrder: t.sortOrder || i,
          })),
        },
      },
      include: { terms: true },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint"))
      return res.status(409).json({ error: "Template name already exists" });
    throw e;
  }
});

paymentTermsTemplateRouter.put("/:id", p.write, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.paymentTermsTemplate.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const updated = await prisma.$transaction(async (tx) => {
    await tx.paymentTermsTemplateItem.deleteMany({
      where: { templateId: existing.id },
    });
    return tx.paymentTermsTemplate.update({
      where: { id: existing.id },
      data: {
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        enabled: parsed.data.enabled,
        terms: {
          create: parsed.data.terms.map((t, i) => ({
            description: t.description,
            invoicePortion: new Prisma.Decimal(t.invoicePortion),
            dueDays: t.dueDays,
            sortOrder: t.sortOrder || i,
          })),
        },
      },
      include: { terms: true },
    });
  });
  res.json(updated);
});

paymentTermsTemplateRouter.delete("/:id", p.delete, async (req, res) => {
  const existing = await prisma.paymentTermsTemplate.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.paymentTermsTemplate.delete({ where: { id: existing.id } });
  res.status(204).send();
});
