import { Router } from "express";
import { z } from "zod";
import { Prisma, prisma, tdsQuarter } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// CRUD for TdsChallan rows. After the tenant deposits deducted TDS to the
// govt each month (Section 200: due by 7th of next month), they enter the
// bank challan here so it can be linked to 26Q + Form 16A.

export const tdsChallanRouter = Router();

const p = perms("TdsChallan");

const upsertSchema = z.object({
  categoryId: z.string().min(1),
  // Basic Statistical Return code — 7 digits, identifies the bank branch.
  bsrCode: z
    .string()
    .regex(/^[0-9]{7}$/, "BSR code must be 7 digits"),
  challanSerialNo: z.string().min(1),
  paidDate: z.string().datetime(),
  amountPaid: z.coerce.number().nonnegative(),
  // FY/quarter that this challan settles. Defaults to whichever contains
  // paidDate (typical case); overridable when the operator is depositing
  // for a prior quarter.
  fyLabel: z.string().optional(),
  quarter: z.coerce.number().int().min(1).max(4).optional(),
  notes: z.string().optional().nullable(),
});

async function validateCategory(tenantId: string, categoryId: string) {
  const c = await prisma.taxWithholdingCategory.findFirst({
    where: { id: categoryId, tenantId },
    select: { id: true },
  });
  return c ? null : "Invalid TDS category";
}

tdsChallanRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.tdsChallan.findMany({
    where: { tenantId: req.auth!.tenantId },
    include: {
      category: { select: { name: true, sectionCode: true } },
    },
    orderBy: { paidDate: "desc" },
    take: 200,
  });
  res.json(rows);
});

tdsChallanRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.tdsChallan.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      category: { select: { name: true, sectionCode: true } },
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

tdsChallanRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const err = await validateCategory(tenantId, parsed.data.categoryId);
  if (err) return res.status(400).json({ error: err });

  const paidDate = new Date(parsed.data.paidDate);
  const q = tdsQuarter(paidDate);
  try {
    const row = await prisma.tdsChallan.create({
      data: {
        tenantId,
        categoryId: parsed.data.categoryId,
        bsrCode: parsed.data.bsrCode,
        challanSerialNo: parsed.data.challanSerialNo,
        paidDate,
        amountPaid: new Prisma.Decimal(parsed.data.amountPaid),
        fyLabel: parsed.data.fyLabel ?? q.fyLabel,
        quarter: parsed.data.quarter ?? q.quarter,
        notes: parsed.data.notes ?? null,
      },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint")) {
      return res.status(409).json({
        error: "Challan with this BSR + serial + paidDate already exists",
      });
    }
    throw e;
  }
});

tdsChallanRouter.put("/:id", p.write, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const existing = await prisma.tdsChallan.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const err = await validateCategory(tenantId, parsed.data.categoryId);
  if (err) return res.status(400).json({ error: err });

  const paidDate = new Date(parsed.data.paidDate);
  const q = tdsQuarter(paidDate);
  const row = await prisma.tdsChallan.update({
    where: { id: existing.id },
    data: {
      categoryId: parsed.data.categoryId,
      bsrCode: parsed.data.bsrCode,
      challanSerialNo: parsed.data.challanSerialNo,
      paidDate,
      amountPaid: new Prisma.Decimal(parsed.data.amountPaid),
      fyLabel: parsed.data.fyLabel ?? q.fyLabel,
      quarter: parsed.data.quarter ?? q.quarter,
      notes: parsed.data.notes ?? null,
    },
  });
  res.json(row);
});

tdsChallanRouter.delete("/:id", p.delete, async (req, res) => {
  const existing = await prisma.tdsChallan.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    select: { id: true },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.tdsChallan.delete({ where: { id: existing.id } });
  res.status(204).send();
});
