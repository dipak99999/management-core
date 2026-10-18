import { Router } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// TCS categories — mirror of tax-withholding-categories.ts but on the sales
// side. Section 206C(1H) is the typical use case: 0.1% on cumulative annual
// sales to a customer above ₹50L. Category = section rate + threshold +
// destination Liability account (TCS Payable). SI snapshots the rate +
// account at create time.

export const taxCollectionCategoryRouter = Router();

const p = perms("TaxCollectionCategory");

const upsertSchema = z.object({
  name: z.string().min(1),
  sectionCode: z.string().max(10).optional().nullable(),
  rate: z.coerce.number().min(0).max(100),
  cumulativeYtd: z.boolean().default(true),
  thresholdAmount: z.coerce.number().nonnegative().default(0),
  accountId: z.string().min(1),
  effectiveFrom: z.string().datetime().optional().nullable(),
  effectiveTo: z.string().datetime().optional().nullable(),
  disabled: z.boolean().default(false),
});

async function validateAccount(tenantId: string, accountId: string) {
  const a = await prisma.account.findFirst({
    where: {
      id: accountId,
      tenantId,
      isGroup: false,
      disabled: false,
      rootType: "Liability",
    },
    select: { id: true },
  });
  return a ? null : "TCS account must be a leaf Liability account";
}

taxCollectionCategoryRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.taxCollectionCategory.findMany({
    where: { tenantId: req.auth!.tenantId },
    include: { account: { select: { accountName: true } } },
    orderBy: { name: "asc" },
  });
  res.json(rows);
});

taxCollectionCategoryRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.taxCollectionCategory.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: { account: { select: { accountName: true } } },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

taxCollectionCategoryRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const err = await validateAccount(tenantId, parsed.data.accountId);
  if (err) return res.status(400).json({ error: err });
  try {
    const row = await prisma.taxCollectionCategory.create({
      data: {
        tenantId,
        name: parsed.data.name,
        sectionCode: parsed.data.sectionCode ?? null,
        cumulativeYtd: parsed.data.cumulativeYtd,
        rate: new Prisma.Decimal(parsed.data.rate),
        thresholdAmount: new Prisma.Decimal(parsed.data.thresholdAmount),
        accountId: parsed.data.accountId,
        effectiveFrom: parsed.data.effectiveFrom ? new Date(parsed.data.effectiveFrom) : null,
        effectiveTo: parsed.data.effectiveTo ? new Date(parsed.data.effectiveTo) : null,
        disabled: parsed.data.disabled,
      },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint"))
      return res.status(409).json({ error: "Category name already exists" });
    throw e;
  }
});

taxCollectionCategoryRouter.put("/:id", p.write, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const existing = await prisma.taxCollectionCategory.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const err = await validateAccount(tenantId, parsed.data.accountId);
  if (err) return res.status(400).json({ error: err });
  const row = await prisma.taxCollectionCategory.update({
    where: { id: existing.id },
    data: {
      name: parsed.data.name,
      sectionCode: parsed.data.sectionCode ?? null,
      cumulativeYtd: parsed.data.cumulativeYtd,
      rate: new Prisma.Decimal(parsed.data.rate),
      thresholdAmount: new Prisma.Decimal(parsed.data.thresholdAmount),
      accountId: parsed.data.accountId,
      effectiveFrom: parsed.data.effectiveFrom ? new Date(parsed.data.effectiveFrom) : null,
      effectiveTo: parsed.data.effectiveTo ? new Date(parsed.data.effectiveTo) : null,
      disabled: parsed.data.disabled,
    },
  });
  res.json(row);
});

taxCollectionCategoryRouter.delete("/:id", p.delete, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const existing = await prisma.taxCollectionCategory.findFirst({
    where: { id: req.params.id, tenantId },
    include: { _count: { select: { customers: true, invoices: true } } },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing._count.customers > 0 || existing._count.invoices > 0) {
    return res.status(400).json({
      error: `Cannot delete: referenced by ${existing._count.customers} customers + ${existing._count.invoices} invoices`,
    });
  }
  await prisma.taxCollectionCategory.delete({ where: { id: existing.id } });
  res.status(204).send();
});
