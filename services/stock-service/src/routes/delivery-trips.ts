import { Router } from "express";
import { z } from "zod";
import { nextName, prisma } from "@lumaara/db";
import { idempotency, perms, publishRealtime } from "@lumaara/service-auth";

// Module 47 — Delivery Trip routes.
//
// A DeliveryTrip groups outgoing DNs into a driver's route. Two create
// paths:
//   POST /delivery-trips             — explicit stops (advanced)
//   POST /delivery-trips/from-dns    — hand a list of DN IDs; stops
//                                       are auto-created in the caller's
//                                       order (driver / dispatcher can
//                                       resequence via PUT afterward).
//
// Lifecycle:
//   Scheduled → InProgress (driver starts) → Completed (all stops done).
//   Per-stop: Pending → Arrived → Delivered | Failed.

export const deliveryTripRouter = Router();
const p = perms("DeliveryNote");

const createSchema = z.object({
  driverName: z.string().max(200).optional().nullable(),
  vehicleNo: z.string().max(50).optional().nullable(),
  scheduledStart: z.string().datetime().optional().nullable(),
  remarks: z.string().max(500).optional().nullable(),
  stops: z
    .array(
      z.object({
        deliveryNoteId: z.string().min(1),
        sequence: z.number().int().min(1),
      }),
    )
    .min(1),
});

const fromDnsSchema = z.object({
  driverName: z.string().max(200).optional().nullable(),
  vehicleNo: z.string().max(50).optional().nullable(),
  scheduledStart: z.string().datetime().optional().nullable(),
  deliveryNoteIds: z.array(z.string()).min(1),
});

deliveryTripRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.deliveryTrip.findMany({
    where: { tenantId: req.auth!.tenantId },
    include: { _count: { select: { stops: true } } },
    orderBy: [{ scheduledStart: "desc" }, { createdAt: "desc" }],
  });
  res.json(rows);
});

deliveryTripRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.deliveryTrip.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      stops: {
        orderBy: { sequence: "asc" },
        include: {
          deliveryNote: {
            select: {
              name: true,
              customer: { select: { customerName: true } },
            },
          },
        },
      },
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

// From-DNs create — the "load these 5 DNs onto a driver's van" path.
// Stops are created in the caller's order (natural array position → sequence).
deliveryTripRouter.post("/from-dns", p.create, async (req, res) => {
  const parsed = fromDnsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;
  const tenantId = req.auth!.tenantId;

  const dns = await prisma.deliveryNote.findMany({
    where: {
      id: { in: b.deliveryNoteIds },
      tenantId,
      status: { in: ["Draft", "Submitted"] },
    },
    include: { customer: { select: { customerName: true } } },
  });
  if (dns.length !== new Set(b.deliveryNoteIds).size) {
    return res.status(400).json({ error: "One or more DNs not found or cancelled" });
  }

  // Preserve caller's input order.
  const orderedDNs = b.deliveryNoteIds
    .map((id) => dns.find((d) => d.id === id))
    .filter((d): d is (typeof dns)[number] => d !== undefined);

  const name = await nextName(prisma, tenantId, "TRIP-");
  const row = await prisma.deliveryTrip.create({
    data: {
      tenantId,
      name,
      driverName: b.driverName ?? null,
      vehicleNo: b.vehicleNo ?? null,
      scheduledStart: b.scheduledStart ? new Date(b.scheduledStart) : null,
      status: "Scheduled",
      stops: {
        create: orderedDNs.map((dn, idx) => ({
          deliveryNoteId: dn.id,
          sequence: idx + 1,
          customerName: dn.customer.customerName,
          status: "Pending",
        })),
      },
    },
    include: { stops: true },
  });
  res.status(201).json(row);
});

deliveryTripRouter.post("/", p.create, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;
  const tenantId = req.auth!.tenantId;

  const dnIds = b.stops.map((s) => s.deliveryNoteId);
  const dns = await prisma.deliveryNote.findMany({
    where: { id: { in: dnIds }, tenantId },
    include: { customer: { select: { customerName: true } } },
  });
  if (dns.length !== new Set(dnIds).size) {
    return res.status(400).json({ error: "One or more DNs invalid or off-tenant" });
  }
  const dnById = new Map(dns.map((d) => [d.id, d]));

  const name = await nextName(prisma, tenantId, "TRIP-");
  const row = await prisma.deliveryTrip.create({
    data: {
      tenantId,
      name,
      driverName: b.driverName ?? null,
      vehicleNo: b.vehicleNo ?? null,
      scheduledStart: b.scheduledStart ? new Date(b.scheduledStart) : null,
      remarks: b.remarks ?? null,
      status: "Scheduled",
      stops: {
        create: b.stops.map((s) => ({
          deliveryNoteId: s.deliveryNoteId,
          sequence: s.sequence,
          customerName: dnById.get(s.deliveryNoteId)!.customer.customerName,
          status: "Pending",
        })),
      },
    },
    include: { stops: true },
  });
  res.status(201).json(row);
});

// Resequence — dispatcher drags stops in the UI, sends the new order.
const resequenceSchema = z.object({
  order: z.array(z.object({ stopId: z.string(), sequence: z.number().int().min(1) })).min(1),
});
deliveryTripRouter.put("/:id/resequence", p.write, async (req, res) => {
  const parsed = resequenceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;

  const trip = await prisma.deliveryTrip.findFirst({
    where: { id: req.params.id, tenantId },
    include: { stops: { select: { id: true } } },
  });
  if (!trip) return res.status(404).json({ error: "Not found" });
  if (trip.status === "Completed" || trip.status === "Cancelled") {
    return res.status(400).json({ error: `Cannot resequence trip in status ${trip.status}` });
  }

  const validStopIds = new Set(trip.stops.map((s) => s.id));
  for (const o of parsed.data.order) {
    if (!validStopIds.has(o.stopId)) {
      return res.status(400).json({ error: `Stop ${o.stopId} not on this trip` });
    }
  }
  // Two-pass to avoid unique-constraint violations mid-update: park all
  // sequences at a large offset first, then set the target values.
  await prisma.$transaction(async (tx) => {
    let park = 10000;
    for (const o of parsed.data.order) {
      await tx.deliveryTripStop.update({
        where: { id: o.stopId },
        data: { sequence: park++ },
      });
    }
    for (const o of parsed.data.order) {
      await tx.deliveryTripStop.update({
        where: { id: o.stopId },
        data: { sequence: o.sequence },
      });
    }
  });
  res.json({ ok: true });
});

deliveryTripRouter.post("/:id/start", p.submit, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const trip = await prisma.deliveryTrip.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!trip) return res.status(404).json({ error: "Not found" });
  if (trip.status !== "Scheduled") {
    return res.status(400).json({ error: `Cannot start trip in status ${trip.status}` });
  }
  const updated = await prisma.deliveryTrip.update({
    where: { id: trip.id },
    data: { status: "InProgress", actualStart: new Date() },
  });
  void publishRealtime(tenantId, "delivery-trip", { id: updated.id, status: "InProgress" });
  res.json(updated);
});

// Mark a single stop delivered/failed. When every stop is settled
// (Delivered or Failed), the trip auto-flips to Completed.
const stopUpdateSchema = z.object({
  status: z.enum(["Arrived", "Delivered", "Failed"]),
  notes: z.string().max(500).optional().nullable(),
  signatureCapture: z.string().max(50000).optional().nullable(),
});
deliveryTripRouter.post("/:id/stops/:stopId", p.write, async (req, res) => {
  const parsed = stopUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;

  const trip = await prisma.deliveryTrip.findFirst({
    where: { id: req.params.id, tenantId },
    include: { stops: true },
  });
  if (!trip) return res.status(404).json({ error: "Not found" });
  if (trip.status === "Cancelled" || trip.status === "Completed") {
    return res.status(400).json({ error: `Cannot update stops on ${trip.status} trip` });
  }
  const stop = trip.stops.find((s) => s.id === req.params.stopId);
  if (!stop) return res.status(404).json({ error: "Stop not found on this trip" });

  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.deliveryTripStop.update({
      where: { id: stop.id },
      data: {
        status: parsed.data.status,
        notes: parsed.data.notes ?? stop.notes,
        signatureCapture: parsed.data.signatureCapture ?? stop.signatureCapture,
        ...(parsed.data.status === "Arrived" ? { arrivedAt: now } : {}),
        ...(parsed.data.status === "Delivered" || parsed.data.status === "Failed"
          ? { completedAt: now }
          : {}),
      },
    });
    const allStops = await tx.deliveryTripStop.findMany({
      where: { deliveryTripId: trip.id },
      select: { status: true },
    });
    const allSettled = allStops.every(
      (s) => s.status === "Delivered" || s.status === "Failed",
    );
    if (allSettled) {
      await tx.deliveryTrip.update({
        where: { id: trip.id },
        data: { status: "Completed", actualEnd: now },
      });
    }
    return { updated, allSettled };
  });
  void publishRealtime(tenantId, "delivery-trip", {
    id: trip.id,
    stopId: stop.id,
    stopStatus: parsed.data.status,
    tripCompleted: result.allSettled,
  });
  res.json(result.updated);
});

deliveryTripRouter.post("/:id/cancel", p.cancel, idempotency("POST /delivery-trips/:id/cancel"), async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const trip = await prisma.deliveryTrip.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!trip) return res.status(404).json({ error: "Not found" });
  if (trip.status === "Cancelled" || trip.status === "Completed") {
    return res.status(400).json({ error: `Cannot cancel ${trip.status} trip` });
  }
  const updated = await prisma.deliveryTrip.update({
    where: { id: trip.id },
    data: { status: "Cancelled" },
  });
  void publishRealtime(tenantId, "delivery-trip", { id: updated.id, status: "Cancelled" });
  res.json(updated);
});
