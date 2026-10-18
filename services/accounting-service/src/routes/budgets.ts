import { Router } from "express";
import { z } from "zod";
import { prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

export const budgetRouter = Router();

const p = perms("Budget");

const createSchema = z.object({
  fiscalYearId: z.string().min(1),
  accountId: z.string().min(1),
  annualAmount: z.coerce.number().nonnegative(),
  notes: z.string().optional().nullable(),
});

budgetRouter.get("/", p.read, async (req, res) => {
  const fiscalYearId = typeof req.query.fiscalYearId === "string"
    ? req.query.fiscalYearId
    : undefined;
  const rows = await prisma.budget.findMany({
    where: {
      tenantId: req.auth!.tenantId,
      ...(fiscalYearId ? { fiscalYearId } : {}),
    },
    include: {
      fiscalYear: { select: { id: true, name: true } },
      account: { select: { id: true, accountName: true, rootType: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  res.json(rows);
});

budgetRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.budget.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      fiscalYear: true,
      account: true,
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

budgetRouter.post("/", p.create, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;

  const [fy, account] = await Promise.all([
    prisma.fiscalYear.findFirst({
      where: { id: parsed.data.fiscalYearId, tenantId },
    }),
    prisma.account.findFirst({
      where: { id: parsed.data.accountId, tenantId, isGroup: false },
    }),
  ]);
  if (!fy) return res.status(400).json({ error: "Invalid fiscal year" });
  if (!account) return res.status(400).json({ error: "Invalid account (must be a leaf)" });

  try {
    const row = await prisma.budget.create({
      data: {
        tenantId,
        fiscalYearId: parsed.data.fiscalYearId,
        accountId: parsed.data.accountId,
        annualAmount: parsed.data.annualAmount,
        notes: parsed.data.notes ?? null,
      },
      include: {
        fiscalYear: { select: { id: true, name: true } },
        account: { select: { id: true, accountName: true, rootType: true } },
      },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint")) {
      return res.status(409).json({
        error: "A budget for this account already exists in the selected fiscal year",
      });
    }
    throw e;
  }
});

budgetRouter.put("/:id", p.write, async (req, res) => {
  const parsed = z
    .object({
      annualAmount: z.coerce.number().nonnegative().optional(),
      notes: z.string().optional().nullable(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const existing = await prisma.budget.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });

  const updated = await prisma.budget.update({
    where: { id: existing.id },
    data: {
      ...(parsed.data.annualAmount !== undefined ? { annualAmount: parsed.data.annualAmount } : {}),
      ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes } : {}),
    },
    include: {
      fiscalYear: { select: { id: true, name: true } },
      account: { select: { id: true, accountName: true, rootType: true } },
    },
  });
  res.json(updated);
});

budgetRouter.delete("/:id", p.delete, async (req, res) => {
  const existing = await prisma.budget.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.budget.delete({ where: { id: existing.id } });
  res.status(204).send();
});

// Variance report: for a given fiscal year, sum active GL entries per budgeted
// account and compare to the budget's annualAmount. Reports absolute + %
// variance and colors over/under. Under `/reports/budget-variance` — same
// permission model as other reports.
budgetRouter.get("/variance/:fiscalYearId", perms("Report").read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const fy = await prisma.fiscalYear.findFirst({
    where: { id: req.params.fiscalYearId, tenantId },
  });
  if (!fy) return res.status(404).json({ error: "Fiscal year not found" });

  const budgets = await prisma.budget.findMany({
    where: { tenantId, fiscalYearId: fy.id },
    include: {
      account: { select: { id: true, accountName: true, rootType: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  // One GL sum per (accountId) within the FY window. Only active entries.
  const accountIds = budgets.map((b) => b.accountId);
  const glSums =
    accountIds.length === 0
      ? []
      : await prisma.gLEntry.groupBy({
          by: ["accountId"],
          where: {
            tenantId,
            isCancelled: false,
            accountId: { in: accountIds },
            postingDate: { gte: fy.startDate, lte: fy.endDate },
          },
          _sum: { debit: true, credit: true },
        });
  const actualBy = new Map<string, number>();
  for (const g of glSums) {
    // Expense/Income: for expenses, "actual spent" = debit − credit; for
    // income, "actual earned" = credit − debit. Since the caller is comparing
    // to a budget amount they typed in as a positive number, both cases
    // reduce to the natural direction. Look up the account's rootType via
    // the budget row to decide sign.
    actualBy.set(
      g.accountId,
      (Number(g._sum.debit ?? 0) - Number(g._sum.credit ?? 0)),
    );
  }

  const rows = budgets.map((b) => {
    const rawDelta = actualBy.get(b.accountId) ?? 0;
    // For Income accounts, the natural balance is credit; flip the sign so
    // "actual" is a positive earnings number to compare against the budget.
    const actual =
      b.account.rootType === "Income" ? -rawDelta : rawDelta;
    const budget = Number(b.annualAmount);
    const variance = actual - budget;
    const variancePct = budget !== 0 ? (variance / budget) * 100 : 0;
    return {
      id: b.id,
      account: b.account,
      budget,
      actual,
      variance,
      variancePct,
    };
  });

  res.json({
    fiscalYear: { id: fy.id, name: fy.name, startDate: fy.startDate, endDate: fy.endDate },
    rows,
    totals: {
      budget: rows.reduce((s, r) => s + r.budget, 0),
      actual: rows.reduce((s, r) => s + r.actual, 0),
      variance: rows.reduce((s, r) => s + r.variance, 0),
    },
  });
});
