import { Router } from "express";
import { z } from "zod";
import { prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

export const workstationRouter = Router();

const p = perms("Workstation");

const upsertSchema = z.object({
  name: z.string().min(1).max(60),
  hourRate: z.coerce.number().nonnegative().default(0),
  workingHoursPerDay: z.coerce.number().positive().default(8),
  description: z.string().optional().nullable(),
});

workstationRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.workstation.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: { name: "asc" },
  });
  res.json(rows);
});

workstationRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const row = await prisma.workstation.create({
      data: { ...parsed.data, tenantId: req.auth!.tenantId },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint")) {
      return res.status(409).json({ error: "Workstation name already exists" });
    }
    throw e;
  }
});

workstationRouter.put("/:id", p.write, async (req, res) => {
  const parsed = upsertSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.workstation.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const row = await prisma.workstation.update({
    where: { id: existing.id },
    data: parsed.data,
  });
  res.json(row);
});

workstationRouter.delete("/:id", p.delete, async (req, res) => {
  const existing = await prisma.workstation.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      _count: { select: { bomOperations: true, woOperations: true, jobCards: true } },
    },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const c = existing._count;
  if (c.bomOperations + c.woOperations + c.jobCards > 0)
    return res.status(400).json({
      error: `Cannot delete: referenced by ${c.bomOperations} BOM op(s), ${c.woOperations} WO op(s), ${c.jobCards} job card(s)`,
    });
  await prisma.workstation.delete({ where: { id: existing.id } });
  res.status(204).send();
});
