import { Router } from "express";
import { z } from "zod";
import { prisma, scoreLead, type LeadScoreRule } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// Lead scoring rules — CRUD + recompute endpoints.

export const leadScoreRuleRouter = Router();
const p = perms("LeadScoreRule");

const OPS = ["eq", "neq", "contains", "present", "absent", "gt", "lt"] as const;

const upsertSchema = z.object({
  name: z.string().min(1).max(120),
  fieldPath: z.string().min(1).max(120),
  operator: z.enum(OPS),
  value: z.string().optional().nullable(),
  points: z.coerce.number().int(),
  applyMode: z.enum(["Add", "Subtract"]).default("Add"),
  enabled: z.boolean().default(true),
  sortOrder: z.coerce.number().int().default(0),
});

leadScoreRuleRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.leadScoreRule.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  res.json(rows);
});

leadScoreRuleRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const row = await prisma.leadScoreRule.create({
      data: { tenantId: req.auth!.tenantId, ...parsed.data },
    });
    res.status(201).json(row);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
  }
});

leadScoreRuleRouter.put("/:id", p.write, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.leadScoreRule.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const row = await prisma.leadScoreRule.update({
    where: { id: existing.id },
    data: parsed.data,
  });
  res.json(row);
});

leadScoreRuleRouter.delete("/:id", p.delete, async (req, res) => {
  const existing = await prisma.leadScoreRule.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.leadScoreRule.delete({ where: { id: existing.id } });
  res.status(204).send();
});

// Bulk recompute — walk every non-Converted / non-Lost Lead in the
// tenant and re-score. Bounded, but paginate if the tenant crosses
// LARGE_TENANT_THRESHOLD.
const LARGE_TENANT_THRESHOLD = 5000;

leadScoreRuleRouter.post("/recompute-all", p.write, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const rules = await prisma.leadScoreRule.findMany({
    where: { tenantId, enabled: true },
    orderBy: { sortOrder: "asc" },
  });
  const ruleShape: LeadScoreRule[] = rules.map((r) => ({
    fieldPath: r.fieldPath,
    operator: r.operator as LeadScoreRule["operator"],
    value: r.value,
    points: r.points,
    applyMode: r.applyMode as LeadScoreRule["applyMode"],
    enabled: r.enabled,
  }));
  const leads = await prisma.lead.findMany({
    where: {
      tenantId,
      status: { notIn: ["Converted", "Lost"] },
    },
    take: LARGE_TENANT_THRESHOLD,
    select: {
      id: true,
      leadName: true,
      companyName: true,
      email: true,
      mobile: true,
      status: true,
      source: true,
      customData: true,
    },
  });
  let updated = 0;
  const now = new Date();
  for (const lead of leads) {
    const { score } = scoreLead(ruleShape, lead as unknown as Record<string, unknown>);
    await prisma.lead.update({
      where: { id: lead.id },
      data: { score, scoredAt: now },
    });
    updated++;
  }
  res.json({
    updated,
    ruleCount: rules.length,
    truncatedAt: leads.length === LARGE_TENANT_THRESHOLD ? LARGE_TENANT_THRESHOLD : null,
  });
});
