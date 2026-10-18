import { Router } from "express";
import { z } from "zod";
import { Prisma, nextName, prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// ═════════════════════════════════════════════════════════════════════
// HOSPITALITY
// ═════════════════════════════════════════════════════════════════════

export const roomRouter = Router();
const pRoom = perms("Room");
const roomSchema = z.object({
  roomNumber: z.string().min(1),
  roomType: z.string().min(1),
  capacity: z.coerce.number().int().min(1).default(2),
  ratePerNight: z.coerce.number().nonnegative(),
  currency: z.string().length(3).default("INR"),
  floor: z.string().optional().nullable(),
  amenities: z.array(z.string()).default([]),
  status: z.enum(["Available", "Occupied", "Cleaning", "Maintenance", "OutOfService"]).default("Available"),
  notes: z.string().optional().nullable(),
});
roomRouter.get("/", pRoom.read, async (req, res) => {
  res.json(
    await prisma.room.findMany({
      where: { tenantId: req.auth!.tenantId },
      orderBy: { roomNumber: "asc" },
    }),
  );
});
roomRouter.post("/", pRoom.create, async (req, res) => {
  const parsed = roomSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;
  const row = await prisma.room.create({
    data: {
      tenantId: req.auth!.tenantId,
      roomNumber: b.roomNumber,
      roomType: b.roomType,
      capacity: b.capacity,
      ratePerNight: new Prisma.Decimal(b.ratePerNight),
      currency: b.currency,
      floor: b.floor ?? null,
      amenities: b.amenities,
      status: b.status,
      notes: b.notes ?? null,
    },
  });
  res.status(201).json(row);
});
roomRouter.put("/:id", pRoom.write, async (req, res) => {
  const parsed = roomSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.room.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId } });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const d = parsed.data;
  res.json(await prisma.room.update({
    where: { id: existing.id },
    data: {
      ...d,
      ...(d.ratePerNight !== undefined ? { ratePerNight: new Prisma.Decimal(d.ratePerNight) } : {}),
    },
  }));
});

export const roomBookingRouter = Router();
const pBooking = perms("RoomBooking");
const bookingSchema = z.object({
  roomId: z.string().min(1),
  guestName: z.string().min(1),
  guestEmail: z.string().email().optional().nullable(),
  guestPhone: z.string().optional().nullable(),
  guestCount: z.coerce.number().int().min(1).default(1),
  checkInDate: z.string().datetime(),
  checkOutDate: z.string().datetime(),
  customerId: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});
roomBookingRouter.get("/", pBooking.read, async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  res.json(
    await prisma.roomBooking.findMany({
      where: {
        tenantId: req.auth!.tenantId,
        ...(status ? { status } : {}),
      },
      include: { room: { select: { roomNumber: true, roomType: true } } },
      orderBy: { checkInDate: "desc" },
      take: 200,
    }),
  );
});
roomBookingRouter.post("/", pBooking.create, async (req, res) => {
  const parsed = bookingSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;
  const tenantId = req.auth!.tenantId;
  const bookingCode = await nextName(prisma, tenantId, "BKG-");
  const room = await prisma.room.findFirst({ where: { id: b.roomId, tenantId } });
  if (!room) return res.status(400).json({ error: "Room not found in tenant" });
  const checkIn = new Date(b.checkInDate);
  const checkOut = new Date(b.checkOutDate);
  const nights = Math.max(1, Math.ceil((checkOut.getTime() - checkIn.getTime()) / (86400 * 1000)));
  const rate = Number(room.ratePerNight);
  const total = rate * nights;
  const row = await prisma.roomBooking.create({
    data: {
      tenantId,
      bookingCode,
      roomId: b.roomId,
      guestName: b.guestName,
      guestEmail: b.guestEmail ?? null,
      guestPhone: b.guestPhone ?? null,
      guestCount: b.guestCount,
      checkInDate: checkIn,
      checkOutDate: checkOut,
      ratePerNight: new Prisma.Decimal(rate),
      totalAmount: new Prisma.Decimal(total),
      currency: room.currency,
      customerId: b.customerId ?? null,
      notes: b.notes ?? null,
    },
  });
  res.status(201).json(row);
});
roomBookingRouter.post("/:id/check-in", pBooking.write, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const bkg = await prisma.roomBooking.findFirst({ where: { id: req.params.id, tenantId } });
  if (!bkg) return res.status(404).json({ error: "Not found" });
  if (bkg.status !== "Booked") return res.status(400).json({ error: `Cannot check in booking in status ${bkg.status}` });
  const row = await prisma.$transaction(async (tx) => {
    await tx.room.update({ where: { id: bkg.roomId }, data: { status: "Occupied" } });
    return tx.roomBooking.update({
      where: { id: bkg.id },
      data: { status: "CheckedIn", actualCheckIn: new Date() },
    });
  });
  res.json(row);
});
roomBookingRouter.post("/:id/check-out", pBooking.write, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const bkg = await prisma.roomBooking.findFirst({ where: { id: req.params.id, tenantId } });
  if (!bkg) return res.status(404).json({ error: "Not found" });
  if (bkg.status !== "CheckedIn") return res.status(400).json({ error: `Cannot check out booking in status ${bkg.status}` });
  const row = await prisma.$transaction(async (tx) => {
    await tx.room.update({ where: { id: bkg.roomId }, data: { status: "Cleaning" } });
    return tx.roomBooking.update({
      where: { id: bkg.id },
      data: { status: "CheckedOut", actualCheckOut: new Date() },
    });
  });
  res.json(row);
});

// ═════════════════════════════════════════════════════════════════════
// AGRICULTURE
// ═════════════════════════════════════════════════════════════════════

export const landUnitRouter = Router();
const pLand = perms("LandUnit");
const landSchema = z.object({
  name: z.string().min(1),
  areaAcres: z.coerce.number().positive(),
  latitude: z.coerce.number().optional().nullable(),
  longitude: z.coerce.number().optional().nullable(),
  soilType: z.string().optional().nullable(),
  irrigation: z.string().optional().nullable(),
  status: z.enum(["Active", "Fallow", "Leased"]).default("Active"),
  notes: z.string().optional().nullable(),
});
landUnitRouter.get("/", pLand.read, async (req, res) => {
  res.json(
    await prisma.landUnit.findMany({
      where: { tenantId: req.auth!.tenantId },
      orderBy: { name: "asc" },
    }),
  );
});
landUnitRouter.post("/", pLand.create, async (req, res) => {
  const parsed = landSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;
  const row = await prisma.landUnit.create({
    data: {
      tenantId: req.auth!.tenantId,
      name: b.name,
      areaAcres: new Prisma.Decimal(b.areaAcres),
      latitude: b.latitude != null ? new Prisma.Decimal(b.latitude) : null,
      longitude: b.longitude != null ? new Prisma.Decimal(b.longitude) : null,
      soilType: b.soilType ?? null,
      irrigation: b.irrigation ?? null,
      status: b.status,
      notes: b.notes ?? null,
    },
  });
  res.status(201).json(row);
});

export const cropCycleRouter = Router();
const pCrop = perms("CropCycle");
const cropSchema = z.object({
  landUnitId: z.string().min(1),
  cropName: z.string().min(1),
  variety: z.string().optional().nullable(),
  sowingDate: z.string().datetime(),
  expectedHarvestDate: z.string().datetime().optional().nullable(),
  seedQty: z.coerce.number().nonnegative().optional().nullable(),
  seedUom: z.string().optional().nullable(),
  expectedYield: z.coerce.number().nonnegative().optional().nullable(),
  yieldUom: z.string().default("kg"),
  notes: z.string().optional().nullable(),
});
cropCycleRouter.get("/", pCrop.read, async (req, res) => {
  res.json(
    await prisma.cropCycle.findMany({
      where: { tenantId: req.auth!.tenantId },
      include: { landUnit: { select: { name: true, areaAcres: true } } },
      orderBy: { sowingDate: "desc" },
    }),
  );
});
cropCycleRouter.get("/:id", pCrop.read, async (req, res) => {
  const row = await prisma.cropCycle.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      landUnit: true,
      activities: { orderBy: { performedAt: "desc" } },
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});
cropCycleRouter.post("/", pCrop.create, async (req, res) => {
  const parsed = cropSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;
  const row = await prisma.cropCycle.create({
    data: {
      tenantId: req.auth!.tenantId,
      landUnitId: b.landUnitId,
      cropName: b.cropName,
      variety: b.variety ?? null,
      sowingDate: new Date(b.sowingDate),
      expectedHarvestDate: b.expectedHarvestDate ? new Date(b.expectedHarvestDate) : null,
      seedQty: b.seedQty != null ? new Prisma.Decimal(b.seedQty) : null,
      seedUom: b.seedUom ?? null,
      expectedYield: b.expectedYield != null ? new Prisma.Decimal(b.expectedYield) : null,
      yieldUom: b.yieldUom,
      notes: b.notes ?? null,
    },
  });
  res.status(201).json(row);
});
cropCycleRouter.post("/:id/harvest", pCrop.write, async (req, res) => {
  const schema = z.object({
    actualYield: z.coerce.number().nonnegative(),
    actualHarvestDate: z.string().datetime().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.cropCycle.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId } });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const row = await prisma.cropCycle.update({
    where: { id: existing.id },
    data: {
      status: "Harvested",
      actualYield: new Prisma.Decimal(parsed.data.actualYield),
      actualHarvestDate: parsed.data.actualHarvestDate ? new Date(parsed.data.actualHarvestDate) : new Date(),
    },
  });
  res.json(row);
});

const activitySchema = z.object({
  activityType: z.enum(["Sowing", "Fertilizer", "Pesticide", "Irrigation", "Harvest", "Inspection"]),
  performedAt: z.string().datetime().optional(),
  quantity: z.coerce.number().nonnegative().optional().nullable(),
  uom: z.string().optional().nullable(),
  cost: z.coerce.number().nonnegative().default(0),
  notes: z.string().optional().nullable(),
});
cropCycleRouter.post("/:id/activities", pCrop.write, async (req, res) => {
  const parsed = activitySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;
  const tenantId = req.auth!.tenantId;
  const cycle = await prisma.cropCycle.findFirst({ where: { id: req.params.id, tenantId } });
  if (!cycle) return res.status(404).json({ error: "Not found" });
  const row = await prisma.$transaction(async (tx) => {
    const activity = await tx.cropActivity.create({
      data: {
        tenantId,
        cropCycleId: cycle.id,
        activityType: b.activityType,
        performedAt: b.performedAt ? new Date(b.performedAt) : new Date(),
        quantity: b.quantity != null ? new Prisma.Decimal(b.quantity) : null,
        uom: b.uom ?? null,
        cost: new Prisma.Decimal(b.cost),
        notes: b.notes ?? null,
      },
    });
    // Roll cost into the cycle running total.
    if (b.cost > 0) {
      await tx.cropCycle.update({
        where: { id: cycle.id },
        data: { totalCost: { increment: new Prisma.Decimal(b.cost) } },
      });
    }
    return activity;
  });
  res.status(201).json(row);
});
