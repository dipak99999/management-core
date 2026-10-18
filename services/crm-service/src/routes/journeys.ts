import { Router } from "express";
import { z } from "zod";
import {
  prisma,
  validateGraph,
  type JourneyEdge,
  type JourneyNode,
} from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// Marketing P2: MarketingJourney CRUD + enrollment API. The scheduler ticks
// enrollments through the graph via services/scheduler/src/jobs/journeys.ts.
//
// Graph shape (nodesJson + edgesJson) is React Flow-compatible; see
// packages/db/src/journey.ts for the node kinds + validator. Activating a
// journey (Draft → Active) triggers validateGraph — a malformed graph is
// refused at that boundary rather than allowed to fail per-enrollment.
//
// Enrollment endpoints:
//   POST /:id/enroll                   — manual/API enroll
//   GET  /:id/enrollments              — list per-status
//   POST /:id/unenroll/:enrollmentId   — set status=Exited
//
// Automatic enrollment (ListAdd / LeadCreated / FormSubmit) is fired from
// the relevant route handlers via `fireJourneyTrigger` — see the corresponding
// routes for the exact call site.

export const journeysRouter = Router();
const p = perms("MarketingJourney");

// ─── Schemas ──────────────────────────────────────────────────────────

const TRIGGER_TYPES = ["Manual", "ListAdd", "LeadCreated", "FormSubmit", "TagAdded", "ScheduledDate"] as const;
const STATUSES = ["Draft", "Active", "Paused", "Archived"] as const;

const upsertCreateSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  triggerType: z.enum(TRIGGER_TYPES).default("Manual"),
  triggerConfig: z.record(z.unknown()).nullable().optional(),
});

const upsertUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  status: z.enum(STATUSES).optional(),
  triggerType: z.enum(TRIGGER_TYPES).optional(),
  triggerConfig: z.record(z.unknown()).nullable().optional(),
  nodesJson: z.array(z.record(z.unknown())).optional(),
  edgesJson: z.array(z.record(z.unknown())).optional(),
});

const enrollSchema = z.object({
  contactType: z.enum(["Customer", "Lead"]),
  contactId: z.string().min(1),
});

// ─── Health ───────────────────────────────────────────────────────────

journeysRouter.get("/health", (_req, res) => {
  res.json({ ok: true, kind: "journeys" });
});

// ─── List / read ──────────────────────────────────────────────────────

journeysRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.marketingJourney.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: { updatedAt: "desc" },
  });
  res.json(rows);
});

journeysRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.marketingJourney.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  const [active, completed, failed] = await Promise.all([
    prisma.journeyEnrollment.count({
      where: { journeyId: row.id, tenantId: req.auth!.tenantId, status: "Active" },
    }),
    prisma.journeyEnrollment.count({
      where: { journeyId: row.id, tenantId: req.auth!.tenantId, status: "Completed" },
    }),
    prisma.journeyEnrollment.count({
      where: { journeyId: row.id, tenantId: req.auth!.tenantId, status: "Failed" },
    }),
  ]);
  res.json({ ...row, counts: { active, completed, failed } });
});

// ─── Create / update / delete ────────────────────────────────────────

journeysRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  // Bootstrap graph with a single trigger node so the editor has something
  // to hang the first edge on. The editor is free to overwrite this on
  // its first PUT.
  const triggerNode: JourneyNode = {
    id: "trigger-1",
    type: "trigger",
    position: { x: 0, y: 0 },
    data: {},
  };
  try {
    const row = await prisma.marketingJourney.create({
      data: {
        tenantId: req.auth!.tenantId,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        status: "Draft",
        triggerType: parsed.data.triggerType,
        triggerConfig: (parsed.data.triggerConfig ?? undefined) as never,
        nodesJson: [triggerNode] as never,
        edgesJson: [] as never,
      },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint"))
      return res.status(409).json({ error: "Journey name already exists" });
    throw e;
  }
});

journeysRouter.put("/:id", p.write, async (req, res) => {
  const parsed = upsertUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.marketingJourney.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });

  // If the caller wants to flip status to Active, validate the graph the
  // caller has (either the freshly-supplied nodes/edges or the persisted
  // ones). Refuse the transition on invalid graph.
  if (parsed.data.status === "Active") {
    const nodes = (parsed.data.nodesJson ?? (existing.nodesJson as unknown as JourneyNode[])) as JourneyNode[];
    const edges = (parsed.data.edgesJson ?? (existing.edgesJson as unknown as JourneyEdge[])) as JourneyEdge[];
    const v = validateGraph(nodes, edges);
    if (!v.ok) return res.status(400).json({ error: "Invalid journey graph", details: v.errors });
  }

  const row = await prisma.marketingJourney.update({
    where: { id: existing.id },
    data: {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
      ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
      ...(parsed.data.triggerType !== undefined ? { triggerType: parsed.data.triggerType } : {}),
      ...(parsed.data.triggerConfig !== undefined
        ? { triggerConfig: (parsed.data.triggerConfig ?? undefined) as never }
        : {}),
      ...(parsed.data.nodesJson !== undefined ? { nodesJson: parsed.data.nodesJson as never } : {}),
      ...(parsed.data.edgesJson !== undefined ? { edgesJson: parsed.data.edgesJson as never } : {}),
    },
  });
  res.json(row);
});

journeysRouter.delete("/:id", p.delete, async (req, res) => {
  const existing = await prisma.marketingJourney.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.marketingJourney.delete({ where: { id: existing.id } });
  res.status(204).end();
});

// ─── Activate / Pause ─────────────────────────────────────────────────

journeysRouter.post("/:id/activate", p.write, async (req, res) => {
  const existing = await prisma.marketingJourney.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const nodes = existing.nodesJson as unknown as JourneyNode[];
  const edges = existing.edgesJson as unknown as JourneyEdge[];
  const v = validateGraph(nodes ?? [], edges ?? []);
  if (!v.ok) return res.status(400).json({ error: "Invalid journey graph", details: v.errors });
  const row = await prisma.marketingJourney.update({
    where: { id: existing.id },
    data: { status: "Active" },
  });
  res.json(row);
});

journeysRouter.post("/:id/pause", p.write, async (req, res) => {
  const existing = await prisma.marketingJourney.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const row = await prisma.marketingJourney.update({
    where: { id: existing.id },
    data: { status: "Paused" },
  });
  res.json(row);
});

// ─── Enrollment ──────────────────────────────────────────────────────

journeysRouter.post("/:id/enroll", p.write, async (req, res) => {
  const parsed = enrollSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const journey = await prisma.marketingJourney.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!journey) return res.status(404).json({ error: "Not found" });

  // Resolve email + mobile off the contact so the sendEmail / sendSms
  // nodes have a target address without a per-node lookup.
  let emailTo: string | null = null;
  let mobileTo: string | null = null;
  if (parsed.data.contactType === "Customer") {
    const c = await prisma.customer.findFirst({
      where: { id: parsed.data.contactId, tenantId },
      select: { email: true, mobile: true },
    });
    if (!c) return res.status(404).json({ error: "Contact not found" });
    emailTo = c.email;
    mobileTo = c.mobile;
  } else {
    const l = await prisma.lead.findFirst({
      where: { id: parsed.data.contactId, tenantId },
      select: { email: true, mobile: true },
    });
    if (!l) return res.status(404).json({ error: "Contact not found" });
    emailTo = l.email;
    mobileTo = l.mobile;
  }

  try {
    const now = new Date();
    const row = await prisma.journeyEnrollment.create({
      data: {
        tenantId,
        journeyId: journey.id,
        contactType: parsed.data.contactType,
        contactId: parsed.data.contactId,
        emailTo,
        mobileTo,
        currentNodeId: null,
        status: "Active",
        nextTickAt: now,
      },
    });
    await prisma.marketingJourney.update({
      where: { id: journey.id },
      data: { totalEnrolled: { increment: 1 } },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint"))
      return res.status(409).json({ error: "Contact already enrolled in this journey" });
    throw e;
  }
});

journeysRouter.get("/:id/enrollments", p.read, async (req, res) => {
  const journey = await prisma.marketingJourney.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    select: { id: true },
  });
  if (!journey) return res.status(404).json({ error: "Not found" });
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const limit = Math.min(Number(req.query.limit ?? 100) || 100, 500);
  const offset = Math.max(Number(req.query.offset ?? 0) || 0, 0);
  const rows = await prisma.journeyEnrollment.findMany({
    where: {
      journeyId: journey.id,
      tenantId: req.auth!.tenantId,
      ...(status ? { status } : {}),
    },
    orderBy: { enrolledAt: "desc" },
    take: limit,
    skip: offset,
  });
  res.json(rows);
});

journeysRouter.post("/:id/unenroll/:enrollmentId", p.write, async (req, res) => {
  const enrollment = await prisma.journeyEnrollment.findFirst({
    where: {
      id: req.params.enrollmentId,
      journeyId: req.params.id,
      tenantId: req.auth!.tenantId,
    },
  });
  if (!enrollment) return res.status(404).json({ error: "Not found" });
  const row = await prisma.journeyEnrollment.update({
    where: { id: enrollment.id },
    data: { status: "Exited", nextTickAt: null },
  });
  res.json(row);
});
