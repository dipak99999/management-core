import { Router } from "express";
import { z } from "zod";
import { prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// Milestones — grouping buckets inside a Project. Zoho-Projects-style: a
// milestone has a due date + status; tasks link via `milestoneId`; Gantt
// renders each milestone as a diamond at its dueDate + a summary bar over
// its child tasks.

export const milestoneRouter = Router();
const p = perms("Milestone");

const upsert = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  status: z.enum(["Upcoming", "InProgress", "Completed", "Missed"]).optional(),
  order: z.number().int().nonnegative().optional(),
});

milestoneRouter.get("/", p.read, async (req, res) => {
  const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
  const rows = await prisma.milestone.findMany({
    where: {
      tenantId: req.auth!.tenantId,
      ...(projectId ? { projectId } : {}),
    },
    include: { _count: { select: { tasks: true } } },
    orderBy: [{ projectId: "asc" }, { order: "asc" }],
  });
  res.json(rows);
});

milestoneRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.milestone.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: { tasks: { orderBy: { sortOrder: "asc" } } },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

milestoneRouter.post("/", p.create, async (req, res) => {
  const parsed = upsert.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const row = await prisma.milestone.create({
    data: {
      tenantId: req.auth!.tenantId,
      projectId: parsed.data.projectId,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null,
      status: parsed.data.status ?? "Upcoming",
      order: parsed.data.order ?? 0,
    },
  });
  res.status(201).json(row);
});

milestoneRouter.put("/:id", p.write, async (req, res) => {
  const parsed = upsert.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.milestone.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const row = await prisma.milestone.update({
    where: { id: existing.id },
    data: {
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null,
      status: parsed.data.status ?? existing.status,
      order: parsed.data.order ?? existing.order,
    },
  });
  res.json(row);
});

milestoneRouter.delete("/:id", p.delete, async (req, res) => {
  await prisma.milestone.deleteMany({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  res.status(204).end();
});
