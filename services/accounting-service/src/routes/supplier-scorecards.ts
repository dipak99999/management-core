import { Router } from "express";
import { z } from "zod";
import { Prisma, prisma, recomputeScorecard } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// Module 46 — Supplier Scorecard routes.
//
// One scorecard per supplier per tenant (enforced by @@unique on
// (tenantId, supplierId)). CRUD is straightforward; the interesting
// endpoint is `POST /:id/recompute` which fetches the raw PO/PR/RFQ
// data for the given period and calls into the pure scoring helpers
// from packages/db.
//
// Recompute is idempotent per (scorecard, fromDate, toDate) — the
// @@unique on SupplierScorecardPeriod turns a re-run into an upsert.

export const supplierScorecardRouter = Router();
const p = perms("PurchaseOrder"); // reuse the buying perm surface

const criterionSchema = z.object({
  formula: z.enum(["OnTimeDelivery", "Fulfillment", "ResponseRate"]),
  weight: z.coerce.number().min(0).max(100),
});

const upsertSchema = z.object({
  supplierId: z.string().min(1),
  name: z.string().min(1).max(200),
  period: z.enum(["Monthly", "Quarterly"]).default("Monthly"),
  isActive: z.boolean().default(true),
  criteria: z.array(criterionSchema).min(1).max(3),
});

supplierScorecardRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.supplierScorecard.findMany({
    where: { tenantId: req.auth!.tenantId },
    include: {
      supplier: { select: { supplierName: true } },
      criteria: true,
      _count: { select: { periods: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
  res.json(rows);
});

supplierScorecardRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.supplierScorecard.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      supplier: true,
      criteria: true,
      periods: { orderBy: { fromDate: "desc" }, take: 24 },
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

supplierScorecardRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;
  const tenantId = req.auth!.tenantId;

  const supplier = await prisma.supplier.findFirst({
    where: { id: b.supplierId, tenantId },
    select: { id: true },
  });
  if (!supplier) return res.status(400).json({ error: "Supplier not found" });

  try {
    const row = await prisma.supplierScorecard.create({
      data: {
        tenantId,
        supplierId: b.supplierId,
        name: b.name,
        period: b.period,
        isActive: b.isActive,
        criteria: {
          create: b.criteria.map((c) => ({
            formula: c.formula,
            weight: new Prisma.Decimal(c.weight),
          })),
        },
      },
      include: { criteria: true },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint")) {
      return res.status(409).json({
        error: "A scorecard already exists for this supplier. Edit it instead of creating a new one.",
      });
    }
    throw e;
  }
});

supplierScorecardRouter.put("/:id", p.write, async (req, res) => {
  const parsed = upsertSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;
  const tenantId = req.auth!.tenantId;
  const existing = await prisma.supplierScorecard.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });

  const updated = await prisma.$transaction(async (tx) => {
    // Criteria are a small set — easier to replace than to diff.
    if (b.criteria) {
      await tx.supplierScorecardCriterion.deleteMany({
        where: { scorecardId: existing.id },
      });
      await tx.supplierScorecardCriterion.createMany({
        data: b.criteria.map((c) => ({
          scorecardId: existing.id,
          formula: c.formula,
          weight: new Prisma.Decimal(c.weight),
        })),
      });
    }
    return tx.supplierScorecard.update({
      where: { id: existing.id },
      data: {
        ...(b.name !== undefined ? { name: b.name } : {}),
        ...(b.period !== undefined ? { period: b.period } : {}),
        ...(b.isActive !== undefined ? { isActive: b.isActive } : {}),
      },
      include: { criteria: true },
    });
  });
  res.json(updated);
});

supplierScorecardRouter.delete("/:id", p.create, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const existing = await prisma.supplierScorecard.findFirst({
    where: { id: req.params.id, tenantId },
    select: { id: true },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.supplierScorecard.delete({ where: { id: existing.id } });
  res.json({ ok: true });
});

// Manual recompute — the scheduler tick calls the same underlying helper.
// Payload picks the window:
//   - Explicit fromDate/toDate, OR
//   - Just `period` = "Monthly"|"Quarterly" (defaults to last complete window).
const recomputeSchema = z.object({
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
  period: z.enum(["Monthly", "Quarterly"]).optional(),
});
supplierScorecardRouter.post("/:id/recompute", p.write, async (req, res) => {
  const parsed = recomputeSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;

  const scorecard = await prisma.supplierScorecard.findFirst({
    where: { id: req.params.id, tenantId },
    include: { criteria: true },
  });
  if (!scorecard) return res.status(404).json({ error: "Not found" });

  const { fromDate, toDate } = resolveWindow(parsed.data, scorecard.period);
  try {
    const period = await recomputeScorecard(prisma, scorecard, fromDate, toDate);
    res.json(period);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Recompute failed" });
  }
});

// Resolves the (fromDate, toDate) window. If the caller passed both,
// use them verbatim. If they passed nothing (or just `period`), pick
// the LAST COMPLETE window (previous calendar month or previous
// calendar quarter) — that's what the scheduler tick wants too.
function resolveWindow(
  input: { fromDate?: string; toDate?: string; period?: string },
  scorecardPeriod: string,
): { fromDate: Date; toDate: Date } {
  if (input.fromDate && input.toDate) {
    return { fromDate: new Date(input.fromDate), toDate: new Date(input.toDate) };
  }
  const now = new Date();
  const period = input.period ?? scorecardPeriod;
  if (period === "Quarterly") {
    // Last complete quarter.
    const q = Math.floor(now.getMonth() / 3);
    const startMonth = q === 0 ? 9 : (q - 1) * 3;
    const startYear = q === 0 ? now.getFullYear() - 1 : now.getFullYear();
    const fromDate = new Date(startYear, startMonth, 1);
    const toDate = new Date(startYear, startMonth + 3, 0, 23, 59, 59);
    return { fromDate, toDate };
  }
  // Monthly: last complete calendar month.
  const fromDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const toDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
  return { fromDate, toDate };
}

