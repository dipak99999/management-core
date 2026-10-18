import { Router } from "express";
import { z } from "zod";
import {
  deriveQIOverallStatus,
  mergeQIReadings,
  nextName,
  prisma,
} from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// C9: Quality Inspection. Two related routers exported:
//   qualityInspectionTemplateRouter  → /quality-inspection-templates
//   qualityInspectionRouter          → /quality-inspections
// PR/DN submit gates on the presence of an Accepted QI when the item
// requires one.

export const qualityInspectionTemplateRouter = Router();
export const qualityInspectionRouter = Router();

const pt = perms("QualityInspectionTemplate");
const pi = perms("QualityInspection");

// ---------- Templates ----------

const templateParamSchema = z.object({
  parameter: z.string().min(1),
  acceptanceCriteria: z.string().optional().nullable(),
  sortOrder: z.coerce.number().int().default(0),
});

const templateUpsertSchema = z.object({
  name: z.string().min(1),
  parameters: z.array(templateParamSchema).min(1),
});

qualityInspectionTemplateRouter.get("/", pt.read, async (req, res) => {
  const rows = await prisma.qualityInspectionTemplate.findMany({
    where: { tenantId: req.auth!.tenantId },
    include: { parameters: { orderBy: { sortOrder: "asc" } } },
    orderBy: { name: "asc" },
  });
  res.json(rows);
});

qualityInspectionTemplateRouter.get("/:id", pt.read, async (req, res) => {
  const row = await prisma.qualityInspectionTemplate.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: { parameters: { orderBy: { sortOrder: "asc" } } },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

qualityInspectionTemplateRouter.post("/", pt.create, async (req, res) => {
  const parsed = templateUpsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  try {
    const row = await prisma.qualityInspectionTemplate.create({
      data: {
        tenantId,
        name: parsed.data.name,
        parameters: {
          create: parsed.data.parameters.map((p) => ({
            parameter: p.parameter,
            acceptanceCriteria: p.acceptanceCriteria ?? null,
            sortOrder: p.sortOrder,
          })),
        },
      },
      include: { parameters: true },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint"))
      return res.status(409).json({ error: "Template name already exists" });
    throw e;
  }
});

qualityInspectionTemplateRouter.put("/:id", pt.write, async (req, res) => {
  const parsed = templateUpsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.qualityInspectionTemplate.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const updated = await prisma.$transaction(async (tx) => {
    await tx.qualityInspectionTemplateItem.deleteMany({
      where: { templateId: existing.id },
    });
    return tx.qualityInspectionTemplate.update({
      where: { id: existing.id },
      data: {
        name: parsed.data.name,
        parameters: {
          create: parsed.data.parameters.map((p) => ({
            parameter: p.parameter,
            acceptanceCriteria: p.acceptanceCriteria ?? null,
            sortOrder: p.sortOrder,
          })),
        },
      },
      include: { parameters: true },
    });
  });
  res.json(updated);
});

qualityInspectionTemplateRouter.delete("/:id", pt.delete, async (req, res) => {
  const existing = await prisma.qualityInspectionTemplate.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      _count: { select: { itemsUsing: true, inspections: true } },
    },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing._count.itemsUsing > 0 || existing._count.inspections > 0)
    return res.status(400).json({
      error: `Cannot delete: used by ${existing._count.itemsUsing} items + ${existing._count.inspections} inspections`,
    });
  await prisma.qualityInspectionTemplate.delete({ where: { id: existing.id } });
  res.status(204).send();
});

// ---------- Inspections ----------

const readingSchema = z.object({
  parameter: z.string().min(1),
  acceptanceCriteria: z.string().optional().nullable(),
  reading: z.string().optional().nullable(),
  status: z.enum(["Accepted", "Rejected"]).default("Accepted"),
});

const inspectionUpsertSchema = z.object({
  inspectionType: z
    .enum(["Incoming", "Outgoing", "In-Process"])
    .default("Incoming"),
  reportDate: z.string().datetime().optional(),
  itemId: z.string().min(1),
  templateId: z.string().optional().nullable(),
  purchaseReceiptItemId: z.string().optional().nullable(),
  deliveryNoteItemId: z.string().optional().nullable(),
  overallStatus: z.enum(["Accepted", "Rejected"]).default("Accepted"),
  inspectedBy: z.string().optional().nullable(),
  remarks: z.string().optional().nullable(),
  readings: z.array(readingSchema).default([]),
});

qualityInspectionRouter.get("/", pi.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const itemId = typeof req.query.itemId === "string" ? req.query.itemId : undefined;
  const prItemId =
    typeof req.query.purchaseReceiptItemId === "string"
      ? req.query.purchaseReceiptItemId
      : undefined;
  const dnItemId =
    typeof req.query.deliveryNoteItemId === "string"
      ? req.query.deliveryNoteItemId
      : undefined;
  const rows = await prisma.qualityInspection.findMany({
    where: {
      tenantId,
      ...(itemId ? { itemId } : {}),
      ...(prItemId ? { purchaseReceiptItemId: prItemId } : {}),
      ...(dnItemId ? { deliveryNoteItemId: dnItemId } : {}),
    },
    include: {
      item: { select: { itemCode: true, itemName: true } },
      template: { select: { name: true } },
    },
    orderBy: { reportDate: "desc" },
  });
  res.json(rows);
});

qualityInspectionRouter.get("/:id", pi.read, async (req, res) => {
  const row = await prisma.qualityInspection.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      item: { select: { itemCode: true, itemName: true } },
      template: true,
      readings: true,
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

// Resolve readings + derived overall status. When a template is attached
// AND the caller supplied no readings (or partial), seed one reading per
// template parameter (preserving caller-supplied reading + status by
// parameter name). Overall status is ALWAYS derived on the server —
// client-supplied `overallStatus` is ignored so an inspector can't submit
// "Accepted" with a Rejected reading and slip past the PR/DN guard.
async function resolveReadingsAndStatus(
  tenantId: string,
  templateId: string | null,
  supplied: Array<{
    parameter: string;
    acceptanceCriteria?: string | null;
    reading?: string | null;
    status: string;
  }>,
): Promise<{
  readings: {
    parameter: string;
    acceptanceCriteria: string | null;
    reading: string | null;
    status: string;
  }[];
  overallStatus: "Accepted" | "Rejected";
}> {
  let templateParams: Array<{ parameter: string; acceptanceCriteria: string | null; sortOrder: number }> = [];
  if (templateId) {
    const t = await prisma.qualityInspectionTemplate.findFirst({
      where: { id: templateId, tenantId },
      include: { parameters: { orderBy: { sortOrder: "asc" } } },
    });
    if (t) templateParams = t.parameters.map((p) => ({ parameter: p.parameter, acceptanceCriteria: p.acceptanceCriteria, sortOrder: p.sortOrder }));
  }
  const merged = mergeQIReadings(templateParams, supplied);
  return {
    readings: merged.map((r) => ({
      parameter: r.parameter,
      acceptanceCriteria: r.acceptanceCriteria ?? null,
      reading: r.reading ?? null,
      status: r.status,
    })),
    overallStatus: deriveQIOverallStatus(merged),
  };
}

qualityInspectionRouter.post("/", pi.create, async (req, res) => {
  const parsed = inspectionUpsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const item = await prisma.item.findFirst({
    where: { id: parsed.data.itemId, tenantId },
  });
  if (!item) return res.status(400).json({ error: "Invalid item" });
  const { readings, overallStatus } = await resolveReadingsAndStatus(
    tenantId,
    parsed.data.templateId ?? null,
    parsed.data.readings,
  );
  const name = await nextName(prisma, tenantId, "QI-");
  const row = await prisma.qualityInspection.create({
    data: {
      tenantId,
      name,
      inspectionType: parsed.data.inspectionType,
      reportDate: parsed.data.reportDate ? new Date(parsed.data.reportDate) : new Date(),
      itemId: parsed.data.itemId,
      templateId: parsed.data.templateId ?? null,
      purchaseReceiptItemId: parsed.data.purchaseReceiptItemId ?? null,
      deliveryNoteItemId: parsed.data.deliveryNoteItemId ?? null,
      overallStatus,
      inspectedBy: parsed.data.inspectedBy ?? null,
      remarks: parsed.data.remarks ?? null,
      readings: { create: readings },
    },
    include: { readings: true },
  });
  res.status(201).json(row);
});

qualityInspectionRouter.put("/:id", pi.write, async (req, res) => {
  const parsed = inspectionUpsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const existing = await prisma.qualityInspection.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const { readings, overallStatus } = await resolveReadingsAndStatus(
    tenantId,
    parsed.data.templateId ?? null,
    parsed.data.readings,
  );
  const updated = await prisma.$transaction(async (tx) => {
    await tx.qualityInspectionReading.deleteMany({
      where: { inspectionId: existing.id },
    });
    return tx.qualityInspection.update({
      where: { id: existing.id },
      data: {
        inspectionType: parsed.data.inspectionType,
        reportDate: parsed.data.reportDate ? new Date(parsed.data.reportDate) : existing.reportDate,
        itemId: parsed.data.itemId,
        templateId: parsed.data.templateId ?? null,
        purchaseReceiptItemId: parsed.data.purchaseReceiptItemId ?? null,
        deliveryNoteItemId: parsed.data.deliveryNoteItemId ?? null,
        overallStatus,
        inspectedBy: parsed.data.inspectedBy ?? null,
        remarks: parsed.data.remarks ?? null,
        readings: { create: readings },
      },
      include: { readings: true },
    });
  });
  res.json(updated);
});

qualityInspectionRouter.delete("/:id", pi.delete, async (req, res) => {
  const existing = await prisma.qualityInspection.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.qualityInspection.delete({ where: { id: existing.id } });
  res.status(204).send();
});
