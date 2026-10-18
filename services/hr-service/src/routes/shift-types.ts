import { Router } from "express";
import { z } from "zod";
import { prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

export const shiftTypeRouter = Router();

const p = perms("ShiftType");

const timeRegex = /^([01]?\d|2[0-3]):[0-5]\d$/;

const upsertSchema = z.object({
  name: z.string().min(1).max(60),
  startTime: z.string().regex(timeRegex, "HH:MM (24h)"),
  endTime: z.string().regex(timeRegex, "HH:MM (24h)"),
  workingHours: z.coerce.number().positive().default(8),
  color: z.string().optional().nullable(),
});

shiftTypeRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.shiftType.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: { name: "asc" },
  });
  res.json(rows);
});

shiftTypeRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const row = await prisma.shiftType.create({
      data: { ...parsed.data, tenantId: req.auth!.tenantId },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint")) {
      return res.status(409).json({ error: "Shift name already exists" });
    }
    throw e;
  }
});

shiftTypeRouter.put("/:id", p.write, async (req, res) => {
  const parsed = upsertSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.shiftType.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const row = await prisma.shiftType.update({
    where: { id: existing.id },
    data: parsed.data,
  });
  res.json(row);
});

shiftTypeRouter.delete("/:id", p.delete, async (req, res) => {
  const existing = await prisma.shiftType.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.shiftType.delete({ where: { id: existing.id } });
  res.status(204).send();
});
