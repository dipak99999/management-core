import { Router } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// Pipeline Blueprint CRUD. Guardrails engine lives in packages/db;
// this file is just admin surface. Validator is invoked by the
// opportunity/lead routes when a status change lands.

export const pipelineBlueprintRouter = Router();
const p = perms("PipelineBlueprint");

const stageSchema = z.object({
  stageKey: z.string().min(1).max(60),
  label: z.string().min(1).max(120),
  sortOrder: z.coerce.number().int().default(0),
  requiredFields: z.array(z.string().min(1)).default([]),
  allowedNext: z.array(z.string().min(1)).default([]),
});

const upsertSchema = z.object({
  doctype: z.string().min(1),
  name: z.string().min(1).max(120),
  description: z.string().optional().nullable(),
  active: z.boolean().default(false),
  stages: z.array(stageSchema).min(1),
});

pipelineBlueprintRouter.get("/", p.read, async (req, res) => {
  const doctype = typeof req.query.doctype === "string" ? req.query.doctype : undefined;
  const rows = await prisma.pipelineBlueprint.findMany({
    where: { tenantId: req.auth!.tenantId, ...(doctype ? { doctype } : {}) },
    include: { stages: { orderBy: { sortOrder: "asc" } } },
    orderBy: [{ doctype: "asc" }, { active: "desc" }, { name: "asc" }],
  });
  res.json(rows);
});

pipelineBlueprintRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.pipelineBlueprint.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: { stages: { orderBy: { sortOrder: "asc" } } },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

pipelineBlueprintRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const d = parsed.data;
  const tenantId = req.auth!.tenantId;
  try {
    const row = await prisma.$transaction(async (tx) => {
      // Only one active per (tenant, doctype). If this new one is active,
      // demote the previous one.
      if (d.active) {
        await tx.pipelineBlueprint.updateMany({
          where: { tenantId, doctype: d.doctype, active: true },
          data: { active: false },
        });
      }
      return tx.pipelineBlueprint.create({
        data: {
          tenantId,
          doctype: d.doctype,
          name: d.name,
          description: d.description ?? null,
          active: d.active,
          stages: {
            create: d.stages.map((s) => ({
              stageKey: s.stageKey,
              label: s.label,
              sortOrder: s.sortOrder,
              requiredFields: s.requiredFields as unknown as Prisma.InputJsonValue,
              allowedNext: s.allowedNext as unknown as Prisma.InputJsonValue,
            })),
          },
        },
        include: { stages: true },
      });
    });
    res.status(201).json(row);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
  }
});

pipelineBlueprintRouter.put("/:id", p.write, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const d = parsed.data;
  const tenantId = req.auth!.tenantId;
  const existing = await prisma.pipelineBlueprint.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  try {
    const row = await prisma.$transaction(async (tx) => {
      if (d.active && !existing.active) {
        await tx.pipelineBlueprint.updateMany({
          where: { tenantId, doctype: d.doctype, active: true, NOT: { id: existing.id } },
          data: { active: false },
        });
      }
      await tx.pipelineBlueprintStage.deleteMany({ where: { blueprintId: existing.id } });
      return tx.pipelineBlueprint.update({
        where: { id: existing.id },
        data: {
          doctype: d.doctype,
          name: d.name,
          description: d.description ?? null,
          active: d.active,
          stages: {
            create: d.stages.map((s) => ({
              stageKey: s.stageKey,
              label: s.label,
              sortOrder: s.sortOrder,
              requiredFields: s.requiredFields as unknown as Prisma.InputJsonValue,
              allowedNext: s.allowedNext as unknown as Prisma.InputJsonValue,
            })),
          },
        },
        include: { stages: true },
      });
    });
    res.json(row);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
  }
});

pipelineBlueprintRouter.delete("/:id", p.delete, async (req, res) => {
  const existing = await prisma.pipelineBlueprint.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.pipelineBlueprint.delete({ where: { id: existing.id } });
  res.status(204).send();
});
