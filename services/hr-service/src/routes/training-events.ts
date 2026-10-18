import { Router } from "express";
import { z } from "zod";
import { prisma, nextName } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// E11: Training Events. Register attendees, mark attendance, capture feedback
// + 1..5 rating.

export const trainingEventRouter = Router();

const p = perms("TrainingEvent");

const eventSchema = z.object({
  subject: z.string().min(1),
  description: z.string().optional().nullable(),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  location: z.string().optional().nullable(),
  trainerName: z.string().optional().nullable(),
});

const attendeeSchema = z.object({
  employeeId: z.string().min(1),
});

const feedbackSchema = z.object({
  attended: z.boolean().optional(),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  feedback: z.string().optional().nullable(),
});

trainingEventRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.trainingEvent.findMany({
    where: { tenantId: req.auth!.tenantId },
    include: { _count: { select: { attendees: true } } },
    orderBy: { startAt: "desc" },
  });
  res.json(rows);
});

trainingEventRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.trainingEvent.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      attendees: {
        include: {
          employee: { select: { id: true, employeeCode: true, employeeName: true } },
        },
      },
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

trainingEventRouter.post("/", p.create, async (req, res) => {
  const parsed = eventSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const name = await nextName(prisma, tenantId, "TRN-");
  const row = await prisma.trainingEvent.create({
    data: {
      tenantId,
      name,
      subject: parsed.data.subject,
      description: parsed.data.description ?? null,
      startAt: new Date(parsed.data.startAt),
      endAt: new Date(parsed.data.endAt),
      location: parsed.data.location ?? null,
      trainerName: parsed.data.trainerName ?? null,
    },
  });
  res.status(201).json(row);
});

trainingEventRouter.post("/:id/status", p.write, async (req, res) => {
  const parsed = z
    .object({ status: z.enum(["Scheduled", "InProgress", "Completed", "Cancelled"]) })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.trainingEvent.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const row = await prisma.trainingEvent.update({
    where: { id: existing.id },
    data: { status: parsed.data.status },
  });
  res.json(row);
});

trainingEventRouter.post("/:id/attendees", p.write, async (req, res) => {
  const parsed = attendeeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const event = await prisma.trainingEvent.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!event) return res.status(404).json({ error: "Not found" });
  const emp = await prisma.employee.findFirst({
    where: { id: parsed.data.employeeId, tenantId },
  });
  if (!emp) return res.status(400).json({ error: "Invalid employee" });
  try {
    const row = await prisma.trainingAttendee.create({
      data: { trainingEventId: event.id, employeeId: emp.id },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint"))
      return res.status(409).json({ error: "Employee already registered" });
    throw e;
  }
});

trainingEventRouter.delete("/:id/attendees/:attendeeId", p.write, async (req, res) => {
  const event = await prisma.trainingEvent.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!event) return res.status(404).json({ error: "Not found" });
  await prisma.trainingAttendee.delete({ where: { id: req.params.attendeeId } });
  res.status(204).send();
});

trainingEventRouter.put("/:id/attendees/:attendeeId", p.write, async (req, res) => {
  const parsed = feedbackSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const event = await prisma.trainingEvent.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!event) return res.status(404).json({ error: "Not found" });
  const row = await prisma.trainingAttendee.update({
    where: { id: req.params.attendeeId },
    data: {
      attended: parsed.data.attended ?? undefined,
      rating: parsed.data.rating ?? undefined,
      feedback: parsed.data.feedback ?? undefined,
    },
  });
  res.json(row);
});
