import { Router } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

export const taxWithholdingCategoryRouter = Router();

const p = perms("TaxWithholdingCategory");

// B13. A TDS category = section rate + threshold + destination account
// (usually a Liability leaf under Statutory Payable). PaymentEntry snapshots
// the rate + account at PE-create time so future edits don't rewrite history.
const upsertSchema = z.object({
  name: z.string().min(1),
  // IT section code — e.g. "194C", "194J". Used to group 26Q return rows.
  // Optional but strongly recommended; blank → "OTHER" in 26Q output.
  sectionCode: z.string().max(10).optional().nullable(),
  rate: z.coerce.number().min(0).max(100),
  // When true (default), threshold is cumulative-YTD (Apr-Mar): TDS applies
  // once total payments to the party in the FY cross the threshold. When
  // false, threshold is per-payment.
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
  return a ? null : "TDS account must be a leaf Liability account";
}

taxWithholdingCategoryRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.taxWithholdingCategory.findMany({
    where: { tenantId: req.auth!.tenantId },
    include: { account: { select: { accountName: true } } },
    orderBy: { name: "asc" },
  });
  res.json(rows);
});

taxWithholdingCategoryRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.taxWithholdingCategory.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: { account: { select: { accountName: true } } },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

taxWithholdingCategoryRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const err = await validateAccount(tenantId, parsed.data.accountId);
  if (err) return res.status(400).json({ error: err });
  try {
    const row = await prisma.taxWithholdingCategory.create({
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

taxWithholdingCategoryRouter.put("/:id", p.write, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const existing = await prisma.taxWithholdingCategory.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const err = await validateAccount(tenantId, parsed.data.accountId);
  if (err) return res.status(400).json({ error: err });
  const row = await prisma.taxWithholdingCategory.update({
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

taxWithholdingCategoryRouter.delete("/:id", p.delete, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const existing = await prisma.taxWithholdingCategory.findFirst({
    where: { id: req.params.id, tenantId },
    include: { _count: { select: { payments: true, suppliers: true } } },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing._count.payments > 0 || existing._count.suppliers > 0) {
    return res.status(400).json({
      error: `Cannot delete: referenced by ${existing._count.payments} payments + ${existing._count.suppliers} suppliers`,
    });
  }
  await prisma.taxWithholdingCategory.delete({ where: { id: existing.id } });
  res.status(204).send();
});
