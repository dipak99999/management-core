import { Router } from "express";
import { z } from "zod";
import { nextName, prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// Module 62 — Quality Non-Conformance routes.
//
// Records + tracks quality failures. Lifecycle:
//   Open → Investigating → Resolved | Closed.
// Regulated industries need this for ISO/GMP audits.

export const nonConformanceRouter = Router();
const p = perms("QualityInspection");

const createSchema = z.object({
  qualityInspectionId: z.string().optional().nullable(),
  itemId: z.string().optional().nullable(),
  batchNo: z.string().max(100).optional().nullable(),
  serialNo: z.string().max(100).optional().nullable(),
  severity: z.enum(["Minor", "Major", "Critical"]).default("Minor"),
  category: z.enum(["Material", "Process", "Documentation", "Other"]).optional().nullable(),
  description: z.string().min(1).max(2000),
  assignedTo: z.string().max(200).optional().nullable(),
});

const updateSchema = z.object({
  severity: z.enum(["Minor", "Major", "Critical"]).optional(),
  category: z.enum(["Material", "Process", "Documentation", "Other"]).optional().nullable(),
  description: z.string().min(1).max(2000).optional(),
  rootCause: z.string().max(2000).optional().nullable(),
  disposition: z.enum(["Rework", "Scrap", "Return to Supplier", "Use As Is"]).optional().nullable(),
  correctiveAction: z.string().max(2000).optional().nullable(),
  preventiveAction: z.string().max(2000).optional().nullable(),
  assignedTo: z.string().max(200).optional().nullable(),
});

nonConformanceRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.nonConformance.findMany({
    where: { tenantId: req.auth!.tenantId },
    include: {
      item: { select: { itemCode: true, itemName: true } },
      qualityInspection: { select: { name: true } },
    },
    orderBy: { reportedOn: "desc" },
    take: 200,
  });
  res.json(rows);
});

nonConformanceRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.nonConformance.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      item: true,
      qualityInspection: { include: { readings: true } },
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

nonConformanceRouter.post("/", p.create, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;
  const tenantId = req.auth!.tenantId;

  if (b.qualityInspectionId) {
    const qi = await prisma.qualityInspection.findFirst({
      where: { id: b.qualityInspectionId, tenantId },
    });
    if (!qi) return res.status(400).json({ error: "QualityInspection not found" });
  }
  if (b.itemId) {
    const item = await prisma.item.count({ where: { id: b.itemId, tenantId } });
    if (!item) return res.status(400).json({ error: "Item not found" });
  }

  const name = await nextName(prisma, tenantId, "NCR-");
  const row = await prisma.nonConformance.create({
    data: {
      tenantId,
      name,
      qualityInspectionId: b.qualityInspectionId ?? null,
      itemId: b.itemId ?? null,
      batchNo: b.batchNo ?? null,
      serialNo: b.serialNo ?? null,
      severity: b.severity,
      category: b.category ?? null,
      description: b.description,
      assignedTo: b.assignedTo ?? null,
      status: "Open",
    },
  });
  res.status(201).json(row);
});

nonConformanceRouter.put("/:id", p.write, async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;
  const tenantId = req.auth!.tenantId;
  const existing = await prisma.nonConformance.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });

  const row = await prisma.nonConformance.update({
    where: { id: existing.id },
    data: {
      ...(b.severity !== undefined ? { severity: b.severity } : {}),
      ...(b.category !== undefined ? { category: b.category } : {}),
      ...(b.description !== undefined ? { description: b.description } : {}),
      ...(b.rootCause !== undefined ? { rootCause: b.rootCause } : {}),
      ...(b.disposition !== undefined ? { disposition: b.disposition } : {}),
      ...(b.correctiveAction !== undefined ? { correctiveAction: b.correctiveAction } : {}),
      ...(b.preventiveAction !== undefined ? { preventiveAction: b.preventiveAction } : {}),
      ...(b.assignedTo !== undefined ? { assignedTo: b.assignedTo } : {}),
    },
  });
  res.json(row);
});

// Lifecycle transitions. Guarded so status can only advance sensibly.
const transitionSchema = z.object({ to: z.enum(["Investigating", "Resolved", "Closed"]) });
nonConformanceRouter.post("/:id/transition", p.write, async (req, res) => {
  const parsed = transitionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const existing = await prisma.nonConformance.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });

  const legal: Record<string, string[]> = {
    Open: ["Investigating"],
    Investigating: ["Resolved"],
    Resolved: ["Closed"],
  };
  const allowed = legal[existing.status] ?? [];
  if (!allowed.includes(parsed.data.to)) {
    return res.status(400).json({
      error: `Cannot transition ${existing.status} → ${parsed.data.to}`,
    });
  }

  const updated = await prisma.nonConformance.update({
    where: { id: existing.id },
    data: {
      status: parsed.data.to,
      ...(parsed.data.to === "Resolved"
        ? { resolvedAt: new Date(), resolvedBy: req.auth!.userId }
        : {}),
    },
  });
  res.json(updated);
});
