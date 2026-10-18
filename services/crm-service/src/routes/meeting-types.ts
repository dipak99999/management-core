import { Router } from "express";
import { z } from "zod";
import { prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// Meeting Scheduler — owner-side CRUD for meeting types + windows.
// Public booking flow is in ./public-bookings.ts.

export const meetingTypeRouter = Router();
const p = perms("MeetingType");

const slugRe = /^[a-z0-9](?:[a-z0-9-]{0,60}[a-z0-9])?$/;

const meetingTypeSchema = z.object({
  slug: z.string().regex(slugRe, "lowercase letters, digits, dashes; 1..62 chars"),
  title: z.string().min(1).max(120),
  description: z.string().optional().nullable(),
  durationMinutes: z.coerce.number().int().min(5).max(24 * 60),
  bufferMinutes: z.coerce.number().int().min(0).max(240).default(0),
  minNoticeMinutes: z.coerce.number().int().min(0).max(30 * 24 * 60).default(60),
  maxAdvanceDays: z.coerce.number().int().min(1).max(365).default(30),
  colorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable(),
  locationType: z.enum(["Video", "Phone", "InPerson", "Custom"]).default("Video"),
  locationDetails: z.string().optional().nullable(),
  redirectUrl: z.string().url().optional().nullable(),
  active: z.boolean().default(true),
});

meetingTypeRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.meetingType.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: [{ active: "desc" }, { title: "asc" }],
  });
  res.json(rows);
});

meetingTypeRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.meetingType.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: { availabilityWindows: true },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

meetingTypeRouter.post("/", p.create, async (req, res) => {
  const parsed = meetingTypeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const row = await prisma.meetingType.create({
      data: {
        tenantId: req.auth!.tenantId,
        ownerUserId: req.auth!.userId,
        ...parsed.data,
      },
    });
    res.status(201).json(row);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
  }
});

meetingTypeRouter.patch("/:id", p.write, async (req, res) => {
  const row = await prisma.meetingType.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  const parsed = meetingTypeSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const updated = await prisma.meetingType.update({
    where: { id: row.id },
    data: parsed.data,
  });
  res.json(updated);
});

meetingTypeRouter.delete("/:id", p.delete, async (req, res) => {
  const row = await prisma.meetingType.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  await prisma.meetingType.delete({ where: { id: row.id } });
  res.status(204).send();
});

// ---------------- Availability windows ----------------

const windowSchema = z.object({
  meetingTypeId: z.string().optional().nullable(),
  dayOfWeek: z.coerce.number().int().min(0).max(6),
  startMinute: z.coerce.number().int().min(0).max(24 * 60),
  endMinute: z.coerce.number().int().min(0).max(24 * 60),
  timezone: z.string().min(1).default("Asia/Kolkata"),
}).refine((w) => w.endMinute > w.startMinute, {
  message: "endMinute must be greater than startMinute",
});

meetingTypeRouter.get("/windows/list", p.read, async (req, res) => {
  const rows = await prisma.availabilityWindow.findMany({
    where: {
      tenantId: req.auth!.tenantId,
      ownerUserId: req.auth!.userId,
    },
    orderBy: [{ dayOfWeek: "asc" }, { startMinute: "asc" }],
  });
  res.json(rows);
});

meetingTypeRouter.post("/windows", p.create, async (req, res) => {
  const parsed = windowSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const w = parsed.data;
  // If meetingTypeId supplied, verify it belongs to this tenant.
  if (w.meetingTypeId) {
    const mt = await prisma.meetingType.findFirst({
      where: { id: w.meetingTypeId, tenantId: req.auth!.tenantId },
      select: { id: true },
    });
    if (!mt) return res.status(400).json({ error: "meetingTypeId not found in this tenant" });
  }
  const row = await prisma.availabilityWindow.create({
    data: {
      tenantId: req.auth!.tenantId,
      ownerUserId: req.auth!.userId,
      meetingTypeId: w.meetingTypeId ?? null,
      dayOfWeek: w.dayOfWeek,
      startMinute: w.startMinute,
      endMinute: w.endMinute,
      timezone: w.timezone,
    },
  });
  res.status(201).json(row);
});

meetingTypeRouter.delete("/windows/:id", p.delete, async (req, res) => {
  const row = await prisma.availabilityWindow.findFirst({
    where: {
      id: req.params.id,
      tenantId: req.auth!.tenantId,
      ownerUserId: req.auth!.userId,
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  await prisma.availabilityWindow.delete({ where: { id: row.id } });
  res.status(204).send();
});
