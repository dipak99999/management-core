import { Router } from "express";
import { z } from "zod";
import { prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

export const leaveTypeRouter = Router();

const p = perms("LeaveType");

const upsertSchema = z.object({
  leaveTypeName: z.string().min(1).max(60),
  isEncashable: z.boolean().default(false),
  maxDaysPerYear: z.coerce.number().int().nonnegative().default(0),
  color: z.string().optional().nullable(),
});

leaveTypeRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.leaveType.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: { leaveTypeName: "asc" },
  });
  res.json(rows);
});

leaveTypeRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.leaveType.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

leaveTypeRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const row = await prisma.leaveType.create({
      data: { ...parsed.data, tenantId: req.auth!.tenantId },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint")) {
      return res.status(409).json({ error: "Leave type name already exists" });
    }
    throw e;
  }
});

leaveTypeRouter.put("/:id", p.write, async (req, res) => {
  const parsed = upsertSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.leaveType.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const row = await prisma.leaveType.update({
    where: { id: existing.id },
    data: parsed.data,
  });
  res.json(row);
});

leaveTypeRouter.delete("/:id", p.delete, async (req, res) => {
  const existing = await prisma.leaveType.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.leaveType.delete({ where: { id: existing.id } });
  res.status(204).send();
});
