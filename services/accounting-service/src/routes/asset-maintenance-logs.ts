import { Router } from "express";
import { z } from "zod";
import { prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// Maintenance logs are informational only in MVP — no GL posting. Cost is
// recorded for reporting but no expense JE is auto-generated (users can create
// a manual JE or an ExpenseClaim for actual maintenance spend).

export const assetMaintenanceLogRouter = Router();

const p = perms("AssetMaintenanceLog");

const createSchema = z.object({
  assetId: z.string().min(1),
  date: z.string().datetime(),
  maintenanceType: z.string().min(1).max(60),
  cost: z.coerce.number().nonnegative().default(0),
  performedBy: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

assetMaintenanceLogRouter.get("/", p.read, async (req, res) => {
  const assetId = typeof req.query.assetId === "string" ? req.query.assetId : undefined;
  const rows = await prisma.assetMaintenanceLog.findMany({
    where: {
      asset: { tenantId: req.auth!.tenantId },
      ...(assetId ? { assetId } : {}),
    },
    include: {
      asset: { select: { id: true, assetCode: true, assetName: true } },
    },
    orderBy: { date: "desc" },
  });
  res.json(rows);
});

assetMaintenanceLogRouter.post("/", p.create, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;

  const asset = await prisma.asset.findFirst({
    where: { id: parsed.data.assetId, tenantId },
  });
  if (!asset) return res.status(400).json({ error: "Invalid asset" });

  const row = await prisma.assetMaintenanceLog.create({
    data: {
      assetId: parsed.data.assetId,
      date: new Date(parsed.data.date),
      maintenanceType: parsed.data.maintenanceType,
      cost: parsed.data.cost,
      performedBy: parsed.data.performedBy ?? null,
      notes: parsed.data.notes ?? null,
    },
    include: {
      asset: { select: { id: true, assetCode: true, assetName: true } },
    },
  });
  res.status(201).json(row);
});

assetMaintenanceLogRouter.delete("/:id", p.delete, async (req, res) => {
  const existing = await prisma.assetMaintenanceLog.findFirst({
    where: {
      id: req.params.id,
      asset: { tenantId: req.auth!.tenantId },
    },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.assetMaintenanceLog.delete({ where: { id: existing.id } });
  res.status(204).send();
});
