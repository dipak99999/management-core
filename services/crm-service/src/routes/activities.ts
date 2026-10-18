import { Router } from "express";
import { z } from "zod";
import { prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// Unified CRM activities — Task / Call / Meeting / Note / Email — all live in
// crm_activities keyed by (parentType, parentId). This one router serves:
//   GET  /activities                          → list w/ filters
//   GET  /activities/timeline/:type/:id       → chronological feed for a record
//   POST /activities                          → create (type-aware validation)
//   PUT  /activities/:id                      → update
//   POST /activities/:id/complete             → mark Task/Call/Meeting done
//   POST /activities/:id/reopen               → undo complete
//   DELETE /activities/:id                    → hard-delete
//   GET  /activities/upcoming                 → my due-soon items
//   GET  /activities/stats                    → counts for kanban badges

export const activityRouter = Router();
const p = perms("CrmActivity");

const TYPES = ["Task", "Call", "Meeting", "Note", "Email"] as const;
const PARENT_TYPES = [
  "Lead", "Opportunity", "Customer", "Deal", "SalesOrder", "Quotation",
  "SalesInvoice", "Employee", "Item",
] as const;
const STATUSES = ["Open", "Completed", "Cancelled", "Overdue"] as const;

// Base schema — type-specific fields validated in a refine.
const baseSchema = z.object({
  type: z.enum(TYPES),
  subject: z.string().min(1),
  description: z.string().nullable().optional(),
  parentType: z.enum(PARENT_TYPES),
  parentId: z.string().min(1),
  priority: z.enum(["Low", "Medium", "High"]).nullable().optional(),
  status: z.enum(STATUSES).optional(),
  dueDate: z.string().datetime().nullable().optional(),
  callDirection: z.enum(["Inbound", "Outbound"]).nullable().optional(),
  callDuration: z.number().int().nonnegative().nullable().optional(),
  callOutcome: z.string().nullable().optional(),
  phoneNumber: z.string().nullable().optional(),
  startAt: z.string().datetime().nullable().optional(),
  endAt: z.string().datetime().nullable().optional(),
  location: z.string().nullable().optional(),
  meetingUrl: z.string().nullable().optional(),
  emailFrom: z.string().nullable().optional(),
  emailTo: z.string().nullable().optional(),
  emailCc: z.string().nullable().optional(),
  assigneeUserId: z.string().nullable().optional(),
});

const createSchema = baseSchema.refine(
  (v) => {
    // Meetings must have a start; calls should ideally have a direction.
    if (v.type === "Meeting" && !v.startAt) return false;
    return true;
  },
  { message: "Meetings require startAt" },
);

const updateSchema = baseSchema.partial();

// ── list w/ filters ───────────────────────────────────────────────────

activityRouter.get("/", p.read, async (req, res) => {
  const {
    type, status, ownerUserId, parentType, parentId, limit,
  } = req.query as Record<string, string | undefined>;
  const rows = await prisma.crmActivity.findMany({
    where: {
      tenantId: req.auth!.tenantId,
      ...(type ? { type } : {}),
      ...(status ? { status } : {}),
      ...(ownerUserId ? { ownerUserId } : {}),
      ...(parentType ? { parentType } : {}),
      ...(parentId ? { parentId } : {}),
    },
    orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
    take: Math.min(Number(limit) || 100, 500),
  });
  res.json(rows);
});

// ── timeline for one record — mixes all activity types + sort by dueDate/created ──

activityRouter.get("/timeline/:parentType/:parentId", p.read, async (req, res) => {
  const rows = await prisma.crmActivity.findMany({
    where: {
      tenantId: req.auth!.tenantId,
      parentType: req.params.parentType,
      parentId: req.params.parentId,
    },
    orderBy: [{ createdAt: "desc" }],
    take: 200,
  });
  res.json(rows);
});

// ── my upcoming (due within 14 days, Open) ────────────────────────────

activityRouter.get("/upcoming", p.read, async (req, res) => {
  const now = new Date();
  const soon = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const rows = await prisma.crmActivity.findMany({
    where: {
      tenantId: req.auth!.tenantId,
      ownerUserId: req.auth!.userId,
      status: "Open",
      OR: [
        { dueDate: { gte: now, lte: soon } },
        { startAt: { gte: now, lte: soon } },
      ],
    },
    orderBy: [{ dueDate: "asc" }, { startAt: "asc" }],
    take: 50,
  });
  res.json(rows);
});

// ── quick counts for badges ───────────────────────────────────────────

activityRouter.get("/stats", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const [openTasks, openCalls, openMeetings, myOpen] = await Promise.all([
    prisma.crmActivity.count({ where: { tenantId, type: "Task",    status: "Open" } }),
    prisma.crmActivity.count({ where: { tenantId, type: "Call",    status: "Open" } }),
    prisma.crmActivity.count({ where: { tenantId, type: "Meeting", status: "Open" } }),
    prisma.crmActivity.count({
      where: { tenantId, ownerUserId: req.auth!.userId, status: "Open" },
    }),
  ]);
  res.json({ openTasks, openCalls, openMeetings, myOpen });
});

// ── get one ───────────────────────────────────────────────────────────

activityRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.crmActivity.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

// ── create ────────────────────────────────────────────────────────────

activityRouter.post("/", p.create, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid" });
  const data = parsed.data;

  const row = await prisma.crmActivity.create({
    data: {
      tenantId: req.auth!.tenantId,
      type: data.type,
      subject: data.subject,
      description: data.description ?? null,
      parentType: data.parentType,
      parentId: data.parentId,
      priority: data.priority ?? null,
      status: data.status ?? "Open",
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      callDirection: data.callDirection ?? null,
      callDuration: data.callDuration ?? null,
      callOutcome: data.callOutcome ?? null,
      phoneNumber: data.phoneNumber ?? null,
      startAt: data.startAt ? new Date(data.startAt) : null,
      endAt: data.endAt ? new Date(data.endAt) : null,
      location: data.location ?? null,
      meetingUrl: data.meetingUrl ?? null,
      emailFrom: data.emailFrom ?? null,
      emailTo: data.emailTo ?? null,
      emailCc: data.emailCc ?? null,
      ownerUserId: req.auth!.userId,
      assigneeUserId: data.assigneeUserId ?? req.auth!.userId,
    },
  });
  res.status(201).json(row);
});

// ── update ────────────────────────────────────────────────────────────

activityRouter.put("/:id", p.write, async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid" });
  const existing = await prisma.crmActivity.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });

  const data = parsed.data;
  const row = await prisma.crmActivity.update({
    where: { id: existing.id },
    data: {
      type: data.type ?? existing.type,
      subject: data.subject ?? existing.subject,
      description: data.description === undefined ? existing.description : data.description,
      priority: data.priority === undefined ? existing.priority : data.priority,
      status: data.status ?? existing.status,
      dueDate: data.dueDate === undefined
        ? existing.dueDate
        : data.dueDate === null ? null : new Date(data.dueDate),
      callDirection: data.callDirection === undefined ? existing.callDirection : data.callDirection,
      callDuration: data.callDuration === undefined ? existing.callDuration : data.callDuration,
      callOutcome: data.callOutcome === undefined ? existing.callOutcome : data.callOutcome,
      phoneNumber: data.phoneNumber === undefined ? existing.phoneNumber : data.phoneNumber,
      startAt: data.startAt === undefined
        ? existing.startAt
        : data.startAt === null ? null : new Date(data.startAt),
      endAt: data.endAt === undefined
        ? existing.endAt
        : data.endAt === null ? null : new Date(data.endAt),
      location: data.location === undefined ? existing.location : data.location,
      meetingUrl: data.meetingUrl === undefined ? existing.meetingUrl : data.meetingUrl,
      assigneeUserId: data.assigneeUserId === undefined ? existing.assigneeUserId : data.assigneeUserId,
    },
  });
  res.json(row);
});

// ── complete / reopen ────────────────────────────────────────────────

activityRouter.post("/:id/complete", p.write, async (req, res) => {
  const existing = await prisma.crmActivity.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const row = await prisma.crmActivity.update({
    where: { id: existing.id },
    data: { status: "Completed", completedAt: new Date() },
  });
  res.json(row);
});

activityRouter.post("/:id/reopen", p.write, async (req, res) => {
  const existing = await prisma.crmActivity.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const row = await prisma.crmActivity.update({
    where: { id: existing.id },
    data: { status: "Open", completedAt: null },
  });
  res.json(row);
});

activityRouter.delete("/:id", p.delete, async (req, res) => {
  const existing = await prisma.crmActivity.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.crmActivity.delete({ where: { id: existing.id } });
  res.status(204).end();
});
