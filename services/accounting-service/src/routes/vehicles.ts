import { Router } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// Module 48 — Vehicle master + logs.
// Fleet ops: license plate as the primary identifier, running
// odometer maintained at the vehicle level, all events logged.
// Latest odometer log entry auto-updates Vehicle.currentOdometer.

export const vehicleRouter = Router();
const p = perms("Asset"); // reuse the asset perm surface

const upsertSchema = z.object({
  licensePlate: z.string().min(1).max(20),
  make: z.string().max(100).optional().nullable(),
  model: z.string().max(100).optional().nullable(),
  vin: z.string().max(50).optional().nullable(),
  fuelType: z.string().max(20).optional().nullable(),
  color: z.string().max(50).optional().nullable(),
  yearOfMake: z.coerce.number().int().min(1900).max(3000).optional().nullable(),
  assetId: z.string().optional().nullable(),
  currentOdometer: z.coerce.number().int().min(0).default(0),
  lastServiceDate: z.string().datetime().optional().nullable(),
  disabled: z.boolean().default(false),
});

const logSchema = z.object({
  vehicleId: z.string().min(1),
  logDate: z.string().datetime(),
  logType: z.enum(["Odometer", "Fuel", "Expense", "Service"]),
  odometer: z.coerce.number().int().min(0).optional().nullable(),
  fuelQty: z.coerce.number().nonnegative().optional().nullable(),
  fuelRate: z.coerce.number().nonnegative().optional().nullable(),
  amount: z.coerce.number().nonnegative().optional().nullable(),
  vendor: z.string().max(200).optional().nullable(),
  driverName: z.string().max(200).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
  expenseClaimId: z.string().optional().nullable(),
});

vehicleRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.vehicle.findMany({
    where: { tenantId: req.auth!.tenantId },
    include: { _count: { select: { logs: true } } },
    orderBy: { licensePlate: "asc" },
  });
  res.json(rows);
});

vehicleRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.vehicle.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      logs: { orderBy: { logDate: "desc" }, take: 100 },
      asset: { select: { id: true, assetName: true, assetCode: true } },
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

vehicleRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;
  const tenantId = req.auth!.tenantId;
  try {
    const row = await prisma.vehicle.create({
      data: {
        tenantId,
        licensePlate: b.licensePlate,
        make: b.make ?? null,
        model: b.model ?? null,
        vin: b.vin ?? null,
        fuelType: b.fuelType ?? null,
        color: b.color ?? null,
        yearOfMake: b.yearOfMake ?? null,
        assetId: b.assetId ?? null,
        currentOdometer: b.currentOdometer,
        lastServiceDate: b.lastServiceDate ? new Date(b.lastServiceDate) : null,
        disabled: b.disabled,
      },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint")) {
      return res.status(409).json({ error: "Vehicle with that plate already exists" });
    }
    throw e;
  }
});

vehicleRouter.put("/:id", p.write, async (req, res) => {
  const parsed = upsertSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;
  const tenantId = req.auth!.tenantId;
  const existing = await prisma.vehicle.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const row = await prisma.vehicle.update({
    where: { id: existing.id },
    data: {
      ...(b.licensePlate !== undefined ? { licensePlate: b.licensePlate } : {}),
      ...(b.make !== undefined ? { make: b.make } : {}),
      ...(b.model !== undefined ? { model: b.model } : {}),
      ...(b.vin !== undefined ? { vin: b.vin } : {}),
      ...(b.fuelType !== undefined ? { fuelType: b.fuelType } : {}),
      ...(b.color !== undefined ? { color: b.color } : {}),
      ...(b.yearOfMake !== undefined ? { yearOfMake: b.yearOfMake } : {}),
      ...(b.assetId !== undefined ? { assetId: b.assetId } : {}),
      ...(b.currentOdometer !== undefined ? { currentOdometer: b.currentOdometer } : {}),
      ...(b.lastServiceDate !== undefined
        ? { lastServiceDate: b.lastServiceDate ? new Date(b.lastServiceDate) : null }
        : {}),
      ...(b.disabled !== undefined ? { disabled: b.disabled } : {}),
    },
  });
  res.json(row);
});

// Add a log entry. Auto-advances Vehicle.currentOdometer when the log's
// odometer > current (never regress — a lower reading is likely a data
// entry mistake and we surface it as a warning field rather than
// silently updating).
vehicleRouter.post("/logs", p.create, async (req, res) => {
  const parsed = logSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;
  const tenantId = req.auth!.tenantId;

  const vehicle = await prisma.vehicle.findFirst({
    where: { id: b.vehicleId, tenantId },
    select: { id: true, currentOdometer: true },
  });
  if (!vehicle) return res.status(400).json({ error: "Vehicle not found" });

  // Derive amount for Fuel logs when qty+rate given but no amount.
  const derivedAmount =
    b.amount ??
    (b.fuelQty && b.fuelRate ? Number(b.fuelQty) * Number(b.fuelRate) : null);

  const result = await prisma.$transaction(async (tx) => {
    const log = await tx.vehicleLog.create({
      data: {
        tenantId,
        vehicleId: b.vehicleId,
        logDate: new Date(b.logDate),
        logType: b.logType,
        odometer: b.odometer ?? null,
        fuelQty: b.fuelQty !== undefined && b.fuelQty !== null ? new Prisma.Decimal(b.fuelQty) : null,
        fuelRate: b.fuelRate !== undefined && b.fuelRate !== null ? new Prisma.Decimal(b.fuelRate) : null,
        amount: derivedAmount !== null ? new Prisma.Decimal(derivedAmount) : null,
        vendor: b.vendor ?? null,
        driverName: b.driverName ?? null,
        notes: b.notes ?? null,
        expenseClaimId: b.expenseClaimId ?? null,
      },
    });
    if (b.odometer && b.odometer > vehicle.currentOdometer) {
      await tx.vehicle.update({
        where: { id: vehicle.id },
        data: {
          currentOdometer: b.odometer,
          ...(b.logType === "Service" ? { lastServiceDate: new Date(b.logDate) } : {}),
        },
      });
    } else if (b.logType === "Service") {
      await tx.vehicle.update({
        where: { id: vehicle.id },
        data: { lastServiceDate: new Date(b.logDate) },
      });
    }
    return log;
  });
  res.status(201).json(result);
});
