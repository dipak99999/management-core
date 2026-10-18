import { Router } from "express";
import { z } from "zod";
import { prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

export const assetCategoryRouter = Router();

const p = perms("AssetCategory");

const upsertSchema = z.object({
  categoryName: z.string().min(1).max(60),
  assetAccountId: z.string().min(1),
  accumDepreciationAccountId: z.string().min(1),
  depExpenseAccountId: z.string().min(1),
  defaultUsefulLifeMonths: z.coerce.number().int().positive().default(36),
});

async function validateAccounts(
  tenantId: string,
  ids: { assetAccountId: string; accumDepreciationAccountId: string; depExpenseAccountId: string },
): Promise<string | null> {
  const accounts = await prisma.account.findMany({
    where: {
      tenantId,
      isGroup: false,
      id: {
        in: [ids.assetAccountId, ids.accumDepreciationAccountId, ids.depExpenseAccountId],
      },
    },
  });
  if (accounts.length !== 3)
    return "One or more accounts not found (all must be non-group tenant accounts)";
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const asset = byId.get(ids.assetAccountId);
  const accum = byId.get(ids.accumDepreciationAccountId);
  const exp = byId.get(ids.depExpenseAccountId);
  if (asset?.rootType !== "Asset")
    return `assetAccount must be an Asset account (got ${asset?.rootType})`;
  if (accum?.rootType !== "Asset")
    return `accumDepreciationAccount must be an Asset account (got ${accum?.rootType})`;
  if (exp?.rootType !== "Expense")
    return `depExpenseAccount must be an Expense account (got ${exp?.rootType})`;
  return null;
}

assetCategoryRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.assetCategory.findMany({
    where: { tenantId: req.auth!.tenantId },
    include: {
      assetAccount: { select: { id: true, accountName: true } },
      accumDepreciationAccount: { select: { id: true, accountName: true } },
      depExpenseAccount: { select: { id: true, accountName: true } },
      _count: { select: { assets: true } },
    },
    orderBy: { categoryName: "asc" },
  });
  res.json(rows);
});

assetCategoryRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;

  const err = await validateAccounts(tenantId, parsed.data);
  if (err) return res.status(400).json({ error: err });

  try {
    const row = await prisma.assetCategory.create({
      data: { ...parsed.data, tenantId },
      include: {
        assetAccount: { select: { id: true, accountName: true } },
        accumDepreciationAccount: { select: { id: true, accountName: true } },
        depExpenseAccount: { select: { id: true, accountName: true } },
      },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint")) {
      return res.status(409).json({ error: "Category name already exists" });
    }
    throw e;
  }
});

assetCategoryRouter.put("/:id", p.write, async (req, res) => {
  const parsed = upsertSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;

  const existing = await prisma.assetCategory.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });

  if (
    parsed.data.assetAccountId ||
    parsed.data.accumDepreciationAccountId ||
    parsed.data.depExpenseAccountId
  ) {
    const err = await validateAccounts(tenantId, {
      assetAccountId: parsed.data.assetAccountId ?? existing.assetAccountId,
      accumDepreciationAccountId:
        parsed.data.accumDepreciationAccountId ?? existing.accumDepreciationAccountId,
      depExpenseAccountId: parsed.data.depExpenseAccountId ?? existing.depExpenseAccountId,
    });
    if (err) return res.status(400).json({ error: err });
  }

  const row = await prisma.assetCategory.update({
    where: { id: existing.id },
    data: parsed.data,
    include: {
      assetAccount: { select: { id: true, accountName: true } },
      accumDepreciationAccount: { select: { id: true, accountName: true } },
      depExpenseAccount: { select: { id: true, accountName: true } },
    },
  });
  res.json(row);
});

assetCategoryRouter.delete("/:id", p.delete, async (req, res) => {
  const existing = await prisma.assetCategory.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: { _count: { select: { assets: true } } },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing._count.assets > 0)
    return res.status(400).json({ error: "Cannot delete: assets reference this category" });
  await prisma.assetCategory.delete({ where: { id: existing.id } });
  res.status(204).send();
});
