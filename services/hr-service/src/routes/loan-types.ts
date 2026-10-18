import { Router } from "express";
import { z } from "zod";
import { prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

export const loanTypeRouter = Router();

const p = perms("LoanType");

const upsertSchema = z.object({
  loanTypeName: z.string().min(1).max(60),
  interestRate: z.coerce.number().nonnegative().default(0),
  defaultTermMonths: z.coerce.number().int().positive().default(12),
  description: z.string().optional().nullable(),
});

loanTypeRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.loanType.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: { loanTypeName: "asc" },
  });
  res.json(rows);
});

loanTypeRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const row = await prisma.loanType.create({
      data: { ...parsed.data, tenantId: req.auth!.tenantId },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint")) {
      return res.status(409).json({ error: "Loan type name already exists" });
    }
    throw e;
  }
});

loanTypeRouter.put("/:id", p.write, async (req, res) => {
  const parsed = upsertSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.loanType.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const row = await prisma.loanType.update({
    where: { id: existing.id },
    data: parsed.data,
  });
  res.json(row);
});

loanTypeRouter.delete("/:id", p.delete, async (req, res) => {
  const existing = await prisma.loanType.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: { _count: { select: { loans: true } } },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing._count.loans > 0)
    return res.status(400).json({ error: "Cannot delete: used by existing loans" });
  await prisma.loanType.delete({ where: { id: existing.id } });
  res.status(204).send();
});
