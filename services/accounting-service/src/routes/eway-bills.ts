import { Router } from "express";
import { z } from "zod";
import {
  canCancelEwb,
  computeEwbValidity,
  prisma,
  quoteEwbExtension,
} from "@lumaara/db";
import { idempotency, perms } from "@lumaara/service-auth";

// Records an EWB the operator generated on the NIC portal (or via a GSP
// integration outside this repo). Persists the returned EWB number +
// validity so the tenant can later update Part-B (vehicle change), extend
// validity when delayed, or cancel within 24h. Payload generation
// (Part-A JSON) stays in the /compliance route.
//
// Route ordering: /:id/update-part-b, /:id/extend, /:id/cancel are all
// POSTs under a param path — safe alongside the GET /:id read.

export const ewayBillRouter = Router();
const p = perms("SalesInvoice"); // eway-bills are per-SI; reuse the SI ACL

const createSchema = z.object({
  salesInvoiceId: z.string().min(1),
  ewbNumber: z.string().min(1).max(24),
  ewbDate: z.string().datetime(),
  distanceKm: z.coerce.number().int().nonnegative(),
  cargoType: z.enum(["Normal", "ODC"]).default("Normal"),
  transportMode: z.number().int().min(1).max(4),   // 1=Road 2=Rail 3=Air 4=Ship
  vehicleNumber: z.string().max(24).optional().nullable(),
  transporterId: z.string().max(24).optional().nullable(),
  transporterName: z.string().max(120).optional().nullable(),
  remarks: z.string().max(2000).optional().nullable(),
});

ewayBillRouter.get("/", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const salesInvoiceId =
    typeof req.query.salesInvoiceId === "string"
      ? req.query.salesInvoiceId
      : undefined;
  const rows = await prisma.eWayBill.findMany({
    where: {
      tenantId,
      ...(salesInvoiceId ? { salesInvoiceId } : {}),
    },
    include: {
      salesInvoice: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  res.json(rows);
});

ewayBillRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.eWayBill.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      salesInvoice: { select: { id: true, name: true, customerId: true } },
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

// Record a fresh EWB. Validity computed via computeEwbValidity (NIC rule
// 138(10) — 1 day per 200km ceiling). Refuses when the SI is Draft/Cancelled.
ewayBillRouter.post("/", p.write, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const body = parsed.data;

  const si = await prisma.salesInvoice.findFirst({
    where: { id: body.salesInvoiceId, tenantId },
    select: { id: true, status: true },
  });
  if (!si) return res.status(400).json({ error: "Invalid sales invoice" });
  if (si.status !== "Submitted" && si.status !== "Paid")
    return res.status(400).json({
      error: `EWB can only be recorded for Submitted or Paid invoices (currently ${si.status})`,
    });

  const ewbDate = new Date(body.ewbDate);
  const { validFrom, validTo } = computeEwbValidity(body.distanceKm, ewbDate, body.cargoType);
  try {
    const row = await prisma.eWayBill.create({
      data: {
        tenantId,
        salesInvoiceId: si.id,
        ewbNumber: body.ewbNumber,
        ewbDate,
        distanceKm: body.distanceKm,
        cargoType: body.cargoType,
        validFrom,
        validTo,
        transportMode: body.transportMode,
        vehicleNumber: body.vehicleNumber ?? null,
        transporterId: body.transporterId ?? null,
        transporterName: body.transporterName ?? null,
        remarks: body.remarks ?? null,
      },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint"))
      return res.status(409).json({
        error: `EWB number ${body.ewbNumber} already recorded for this tenant`,
      });
    throw e;
  }
});

// Part-B update — vehicle change during transit (multi-modal, break-bulk,
// or trans-shipment). Cheap: just overwrite the fields + stamp partBUpdatedAt.
// No validity impact (that's the /extend flow).
const partBSchema = z.object({
  vehicleNumber: z.string().max(24).optional().nullable(),
  transportMode: z.number().int().min(1).max(4).optional(),
  transporterId: z.string().max(24).optional().nullable(),
  transporterName: z.string().max(120).optional().nullable(),
  remarks: z.string().max(2000).optional().nullable(),
});

ewayBillRouter.post("/:id/update-part-b", p.write, async (req, res) => {
  const parsed = partBSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const existing = await prisma.eWayBill.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.status !== "Active")
    return res.status(400).json({
      error: `Cannot update Part-B on ${existing.status} EWB`,
    });
  const row = await prisma.eWayBill.update({
    where: { id: existing.id },
    data: {
      ...(parsed.data.vehicleNumber !== undefined
        ? { vehicleNumber: parsed.data.vehicleNumber }
        : {}),
      ...(parsed.data.transportMode !== undefined
        ? { transportMode: parsed.data.transportMode }
        : {}),
      ...(parsed.data.transporterId !== undefined
        ? { transporterId: parsed.data.transporterId }
        : {}),
      ...(parsed.data.transporterName !== undefined
        ? { transporterName: parsed.data.transporterName }
        : {}),
      ...(parsed.data.remarks !== undefined
        ? { remarks: parsed.data.remarks }
        : {}),
      partBUpdatedAt: new Date(),
    },
  });
  res.json(row);
});

// Extend validity. Uses quoteEwbExtension for the 8h-window rule +
// distance-to-days ceiling. Increments extendedCount for audit.
const extendSchema = z.object({
  additionalDistanceKm: z.coerce.number().int().positive(),
  reason: z.string().max(1000).optional().nullable(),
});

ewayBillRouter.post("/:id/extend", p.write, async (req, res) => {
  const parsed = extendSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const existing = await prisma.eWayBill.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.status !== "Active")
    return res.status(400).json({
      error: `Cannot extend ${existing.status} EWB`,
    });

  const quote = quoteEwbExtension({
    currentValidTo: existing.validTo,
    additionalDistanceKm: parsed.data.additionalDistanceKm,
    now: new Date(),
    cargoType: (existing.cargoType === "ODC" ? "ODC" : "Normal"),
  });
  if (!quote.ok) return res.status(400).json({ error: quote.reason });

  const row = await prisma.eWayBill.update({
    where: { id: existing.id },
    data: {
      validTo: quote.newValidTo,
      distanceKm: existing.distanceKm + parsed.data.additionalDistanceKm,
      extendedCount: { increment: 1 },
      remarks: parsed.data.reason
        ? `${existing.remarks ?? ""}\n[extended] ${parsed.data.reason}`.trim()
        : existing.remarks,
    },
  });
  res.json({ ...row, addedDays: quote.additionalDays });
});

// Cancel — 24h window per NIC rule 138(9).
const cancelSchema = z.object({
  reason: z.string().min(1).max(1000),
});

ewayBillRouter.post("/:id/cancel", p.write, idempotency("POST /eway-bills/:id/cancel"), async (req, res) => {
  const parsed = cancelSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const existing = await prisma.eWayBill.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.status === "Cancelled")
    return res.status(400).json({ error: "Already cancelled" });
  const check = canCancelEwb({ ewbDate: existing.ewbDate, now: new Date() });
  if (!check.ok) return res.status(400).json({ error: check.reason });

  const row = await prisma.eWayBill.update({
    where: { id: existing.id },
    data: {
      status: "Cancelled",
      cancelledAt: new Date(),
      cancelledReason: parsed.data.reason,
    },
  });
  res.json(row);
});
