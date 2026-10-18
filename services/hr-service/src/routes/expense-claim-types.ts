import { Router } from "express";
import { z } from "zod";
import { prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

export const expenseClaimTypeRouter = Router();

const p = perms("ExpenseClaimType");

const upsertSchema = z.object({
  typeName: z.string().min(1).max(60),
  expenseAccountId: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
});

expenseClaimTypeRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.expenseClaimType.findMany({
    where: { tenantId: req.auth!.tenantId },
    include: { expenseAccount: { select: { id: true, accountName: true } } },
    orderBy: { typeName: "asc" },
  });
  res.json(rows);
});

expenseClaimTypeRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;

  if (parsed.data.expenseAccountId) {
    const acc = await prisma.account.findFirst({
      where: { id: parsed.data.expenseAccountId, tenantId, isGroup: false },
    });
    if (!acc) return res.status(400).json({ error: "Invalid expense account (must be leaf)" });
  }

  try {
    const row = await prisma.expenseClaimType.create({
      data: { ...parsed.data, tenantId },
      include: { expenseAccount: { select: { id: true, accountName: true } } },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint")) {
      return res.status(409).json({ error: "Type name already exists" });
    }
    throw e;
  }
});

expenseClaimTypeRouter.put("/:id", p.write, async (req, res) => {
  const parsed = upsertSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.expenseClaimType.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const row = await prisma.expenseClaimType.update({
    where: { id: existing.id },
    data: parsed.data,
    include: { expenseAccount: { select: { id: true, accountName: true } } },
  });
  res.json(row);
});

expenseClaimTypeRouter.delete("/:id", p.delete, async (req, res) => {
  const existing = await prisma.expenseClaimType.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: { _count: { select: { items: true } } },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing._count.items > 0)
    return res.status(400).json({ error: "Cannot delete: used by existing claims" });
  await prisma.expenseClaimType.delete({ where: { id: existing.id } });
  res.status(204).send();
});
