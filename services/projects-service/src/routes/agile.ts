import { Router } from "express";
import { z } from "zod";
import { prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// Zoho-Sprints-style agile module.
//   Workspace  → holds a team's sprints, epics, work items, releases, OKRs
//   Sprint     → time-boxed batch of work items (Planning → Active → Completed)
//   Epic       → theme grouping work items across sprints
//   WorkItem   → the unit (Story/Task/Bug/SubTask) auto-keyed like "LUM-42"
//   Release    → deployment/version target
//   Okr        → objective with KeyResults for progress tracking
// Work-item board = grouped by status; backlog = sprintId null.

export const agileRouter = Router();

const workspacePerms = perms("AgileWorkspace");
const sprintPerms    = perms("Sprint");
const epicPerms      = perms("Epic");
const itemPerms      = perms("WorkItem");
const releasePerms   = perms("Release");
const okrPerms       = perms("Okr");

/* ────────────────────────────── WORKSPACES ────────────────────────────── */

const workspaceUpsert = z.object({
  name: z.string().min(1).max(120),
  key: z.string().min(2).max(6).regex(/^[A-Z][A-Z0-9]+$/, "Key must be UPPER letters/digits, start with letter"),
  description: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

agileRouter.get("/workspaces", workspacePerms.read, async (req, res) => {
  const rows = await prisma.agileWorkspace.findMany({
    where: { tenantId: req.auth!.tenantId },
    include: {
      _count: { select: { sprints: true, epics: true, workItems: true, releases: true, okrs: true } },
    },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });
  res.json(rows);
});

agileRouter.get("/workspaces/:id", workspacePerms.read, async (req, res) => {
  const row = await prisma.agileWorkspace.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      _count: { select: { sprints: true, epics: true, workItems: true, releases: true, okrs: true } },
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

agileRouter.post("/workspaces", workspacePerms.create, async (req, res) => {
  const parsed = workspaceUpsert.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const key = parsed.data.key.toUpperCase();
  const dup = await prisma.agileWorkspace.findUnique({ where: { tenantId_key: { tenantId, key } } });
  if (dup) return res.status(400).json({ error: `Workspace key "${key}" already in use` });
  const row = await prisma.agileWorkspace.create({
    data: {
      tenantId,
      name: parsed.data.name,
      key,
      description: parsed.data.description ?? null,
      isActive: parsed.data.isActive ?? true,
    },
  });
  res.status(201).json(row);
});

agileRouter.put("/workspaces/:id", workspacePerms.write, async (req, res) => {
  const parsed = workspaceUpsert.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.agileWorkspace.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const data: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.description !== undefined) data.description = parsed.data.description;
  if (parsed.data.isActive !== undefined) data.isActive = parsed.data.isActive;
  // key is immutable once created — work-item keys reference it.
  const row = await prisma.agileWorkspace.update({ where: { id: existing.id }, data });
  res.json(row);
});

agileRouter.delete("/workspaces/:id", workspacePerms.delete, async (req, res) => {
  const existing = await prisma.agileWorkspace.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: { _count: { select: { workItems: true } } },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing._count.workItems > 0)
    return res.status(400).json({ error: "Cannot delete: workspace has work items" });
  await prisma.agileWorkspace.delete({ where: { id: existing.id } });
  res.status(204).send();
});

/* ──────────────────────────────── SPRINTS ─────────────────────────────── */

const sprintUpsert = z.object({
  workspaceId: z.string().min(1),
  name: z.string().min(1).max(120),
  goal: z.string().nullable().optional(),
  status: z.enum(["Planning", "Active", "Completed", "Cancelled"]).optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
});

async function assertWorkspace(id: string, tenantId: string) {
  const w = await prisma.agileWorkspace.findFirst({ where: { id, tenantId } });
  if (!w) throw new Error("Invalid workspace");
  return w;
}

agileRouter.get("/sprints", sprintPerms.read, async (req, res) => {
  const workspaceId = typeof req.query.workspaceId === "string" ? req.query.workspaceId : undefined;
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  if (!workspaceId) return res.status(400).json({ error: "workspaceId is required" });
  await assertWorkspace(workspaceId, req.auth!.tenantId);
  const rows = await prisma.sprint.findMany({
    where: { workspaceId, ...(status ? { status } : {}) },
    include: { _count: { select: { workItems: true } } },
    orderBy: [{ status: "asc" }, { startDate: "desc" }, { createdAt: "desc" }],
  });
  res.json(rows);
});

agileRouter.get("/sprints/:id", sprintPerms.read, async (req, res) => {
  const row = await prisma.sprint.findFirst({
    where: { id: req.params.id, workspace: { tenantId: req.auth!.tenantId } },
    include: {
      workspace: { select: { id: true, key: true, name: true } },
      workItems: { orderBy: [{ status: "asc" }, { sortOrder: "asc" }] },
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

agileRouter.post("/sprints", sprintPerms.create, async (req, res) => {
  const parsed = sprintUpsert.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  await assertWorkspace(parsed.data.workspaceId, req.auth!.tenantId).catch((e) => {
    res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
    throw e;
  });
  const row = await prisma.sprint.create({
    data: {
      workspaceId: parsed.data.workspaceId,
      name: parsed.data.name,
      goal: parsed.data.goal ?? null,
      status: parsed.data.status ?? "Planning",
      startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : null,
      endDate: parsed.data.endDate ? new Date(parsed.data.endDate) : null,
    },
  });
  res.status(201).json(row);
});

agileRouter.put("/sprints/:id", sprintPerms.write, async (req, res) => {
  const parsed = sprintUpsert.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.sprint.findFirst({
    where: { id: req.params.id, workspace: { tenantId: req.auth!.tenantId } },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const data: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.goal !== undefined) data.goal = parsed.data.goal;
  if (parsed.data.status !== undefined) data.status = parsed.data.status;
  if (parsed.data.startDate !== undefined)
    data.startDate = parsed.data.startDate ? new Date(parsed.data.startDate) : null;
  if (parsed.data.endDate !== undefined)
    data.endDate = parsed.data.endDate ? new Date(parsed.data.endDate) : null;
  const row = await prisma.sprint.update({ where: { id: existing.id }, data });
  res.json(row);
});

// Start sprint — sets status Active + actualStartAt.
agileRouter.post("/sprints/:id/start", sprintPerms.write, async (req, res) => {
  const existing = await prisma.sprint.findFirst({
    where: { id: req.params.id, workspace: { tenantId: req.auth!.tenantId } },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.status === "Active") return res.status(400).json({ error: "Sprint is already active" });
  const row = await prisma.sprint.update({
    where: { id: existing.id },
    data: { status: "Active", actualStartAt: new Date() },
  });
  res.json(row);
});

// Complete sprint — status Completed + actualEndAt. Optionally move
// incomplete items to backlog (default) or another sprint.
agileRouter.post("/sprints/:id/complete", sprintPerms.write, async (req, res) => {
  const target = typeof req.body?.moveIncompleteTo === "string" ? req.body.moveIncompleteTo : null;
  const existing = await prisma.sprint.findFirst({
    where: { id: req.params.id, workspace: { tenantId: req.auth!.tenantId } },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (target) {
    const t = await prisma.sprint.findFirst({
      where: { id: target, workspaceId: existing.workspaceId },
    });
    if (!t) return res.status(400).json({ error: "Invalid destination sprint" });
  }
  const [movedCount, row] = await prisma.$transaction([
    prisma.workItem.updateMany({
      where: { sprintId: existing.id, status: { notIn: ["Done", "Cancelled"] } },
      data: { sprintId: target },
    }),
    prisma.sprint.update({
      where: { id: existing.id },
      data: { status: "Completed", actualEndAt: new Date() },
    }),
  ]);
  res.json({ sprint: row, movedIncomplete: movedCount.count, movedTo: target ?? "backlog" });
});

agileRouter.delete("/sprints/:id", sprintPerms.delete, async (req, res) => {
  const existing = await prisma.sprint.findFirst({
    where: { id: req.params.id, workspace: { tenantId: req.auth!.tenantId } },
    include: { _count: { select: { workItems: true } } },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing._count.workItems > 0)
    return res.status(400).json({ error: "Move or delete work items first" });
  await prisma.sprint.delete({ where: { id: existing.id } });
  res.status(204).send();
});

/* ──────────────────────────────── EPICS ───────────────────────────────── */

const epicUpsert = z.object({
  workspaceId: z.string().min(1),
  name: z.string().min(1).max(120),
  description: z.string().nullable().optional(),
  color: z.enum(["violet", "blue", "green", "amber", "rose"]).optional(),
  status: z.enum(["Open", "InProgress", "Completed", "Cancelled"]).optional(),
  targetDate: z.string().nullable().optional(),
});

agileRouter.get("/epics", epicPerms.read, async (req, res) => {
  const workspaceId = typeof req.query.workspaceId === "string" ? req.query.workspaceId : undefined;
  if (!workspaceId) return res.status(400).json({ error: "workspaceId is required" });
  await assertWorkspace(workspaceId, req.auth!.tenantId);
  const rows = await prisma.epic.findMany({
    where: { workspaceId },
    include: { _count: { select: { workItems: true } } },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });
  res.json(rows);
});

agileRouter.post("/epics", epicPerms.create, async (req, res) => {
  const parsed = epicUpsert.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  await assertWorkspace(parsed.data.workspaceId, req.auth!.tenantId).catch((e) => {
    res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
    throw e;
  });
  const row = await prisma.epic.create({
    data: {
      workspaceId: parsed.data.workspaceId,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      color: parsed.data.color ?? "violet",
      status: parsed.data.status ?? "Open",
      targetDate: parsed.data.targetDate ? new Date(parsed.data.targetDate) : null,
    },
  });
  res.status(201).json(row);
});

agileRouter.put("/epics/:id", epicPerms.write, async (req, res) => {
  const parsed = epicUpsert.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.epic.findFirst({
    where: { id: req.params.id, workspace: { tenantId: req.auth!.tenantId } },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const data: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.description !== undefined) data.description = parsed.data.description;
  if (parsed.data.color !== undefined) data.color = parsed.data.color;
  if (parsed.data.status !== undefined) data.status = parsed.data.status;
  if (parsed.data.targetDate !== undefined)
    data.targetDate = parsed.data.targetDate ? new Date(parsed.data.targetDate) : null;
  const row = await prisma.epic.update({ where: { id: existing.id }, data });
  res.json(row);
});

agileRouter.delete("/epics/:id", epicPerms.delete, async (req, res) => {
  const existing = await prisma.epic.findFirst({
    where: { id: req.params.id, workspace: { tenantId: req.auth!.tenantId } },
    include: { _count: { select: { workItems: true } } },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  // Null-out epic on items rather than block; epic is a soft grouping.
  await prisma.$transaction([
    prisma.workItem.updateMany({ where: { epicId: existing.id }, data: { epicId: null } }),
    prisma.epic.delete({ where: { id: existing.id } }),
  ]);
  res.status(204).send();
});

/* ─────────────────────────────── RELEASES ─────────────────────────────── */

const releaseUpsert = z.object({
  workspaceId: z.string().min(1),
  name: z.string().min(1).max(60),
  description: z.string().nullable().optional(),
  targetDate: z.string().nullable().optional(),
  status: z.enum(["Planned", "InProgress", "Released", "Cancelled"]).optional(),
});

agileRouter.get("/releases", releasePerms.read, async (req, res) => {
  const workspaceId = typeof req.query.workspaceId === "string" ? req.query.workspaceId : undefined;
  if (!workspaceId) return res.status(400).json({ error: "workspaceId is required" });
  await assertWorkspace(workspaceId, req.auth!.tenantId);
  const rows = await prisma.release.findMany({
    where: { workspaceId },
    include: { _count: { select: { workItems: true } } },
    orderBy: [{ status: "asc" }, { targetDate: "asc" }],
  });
  res.json(rows);
});

agileRouter.post("/releases", releasePerms.create, async (req, res) => {
  const parsed = releaseUpsert.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  await assertWorkspace(parsed.data.workspaceId, req.auth!.tenantId).catch((e) => {
    res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
    throw e;
  });
  const row = await prisma.release.create({
    data: {
      workspaceId: parsed.data.workspaceId,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      status: parsed.data.status ?? "Planned",
      targetDate: parsed.data.targetDate ? new Date(parsed.data.targetDate) : null,
    },
  });
  res.status(201).json(row);
});

agileRouter.put("/releases/:id", releasePerms.write, async (req, res) => {
  const parsed = releaseUpsert.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.release.findFirst({
    where: { id: req.params.id, workspace: { tenantId: req.auth!.tenantId } },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const data: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.description !== undefined) data.description = parsed.data.description;
  if (parsed.data.status !== undefined) {
    data.status = parsed.data.status;
    if (parsed.data.status === "Released" && !existing.releasedAt) data.releasedAt = new Date();
  }
  if (parsed.data.targetDate !== undefined)
    data.targetDate = parsed.data.targetDate ? new Date(parsed.data.targetDate) : null;
  const row = await prisma.release.update({ where: { id: existing.id }, data });
  res.json(row);
});

agileRouter.delete("/releases/:id", releasePerms.delete, async (req, res) => {
  const existing = await prisma.release.findFirst({
    where: { id: req.params.id, workspace: { tenantId: req.auth!.tenantId } },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.$transaction([
    prisma.workItem.updateMany({ where: { releaseId: existing.id }, data: { releaseId: null } }),
    prisma.release.delete({ where: { id: existing.id } }),
  ]);
  res.status(204).send();
});

/* ────────────────────────────── WORK ITEMS ────────────────────────────── */

const itemUpsert = z.object({
  workspaceId: z.string().min(1),
  type: z.enum(["Story", "Task", "Bug", "SubTask"]).default("Task"),
  title: z.string().min(1).max(240),
  description: z.string().nullable().optional(),
  status: z.enum(["Todo", "InProgress", "InReview", "Done", "Cancelled"]).optional(),
  priority: z.enum(["Low", "Medium", "High", "Urgent"]).optional(),
  points: z.coerce.number().int().min(0).max(100).nullable().optional(),
  assigneeUserIds: z.array(z.string()).optional(),
  reporterUserId: z.string().nullable().optional(),
  parentWorkItemId: z.string().nullable().optional(),
  epicId: z.string().nullable().optional(),
  sprintId: z.string().nullable().optional(),
  releaseId: z.string().nullable().optional(),
  labels: z.array(z.string()).optional(),
  dueDate: z.string().nullable().optional(),
  sortOrder: z.coerce.number().int().optional(),
});

// Compose next key ("LUM-42"). We scan existing items for the workspace to
// pick max numeric suffix — small workspaces so a table scan is fine.
async function nextWorkItemKey(workspaceKey: string, workspaceId: string) {
  const items = await prisma.workItem.findMany({
    where: { workspaceId },
    select: { key: true },
  });
  const prefix = `${workspaceKey}-`;
  let max = 0;
  for (const { key } of items) {
    if (!key.startsWith(prefix)) continue;
    const n = Number(key.slice(prefix.length));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}${max + 1}`;
}

agileRouter.get("/work-items", itemPerms.read, async (req, res) => {
  const workspaceId = typeof req.query.workspaceId === "string" ? req.query.workspaceId : undefined;
  if (!workspaceId) return res.status(400).json({ error: "workspaceId is required" });
  await assertWorkspace(workspaceId, req.auth!.tenantId);
  const filter: Record<string, unknown> = { workspaceId };
  const sprintId = typeof req.query.sprintId === "string" ? req.query.sprintId : undefined;
  const status   = typeof req.query.status   === "string" ? req.query.status   : undefined;
  const epicId   = typeof req.query.epicId   === "string" ? req.query.epicId   : undefined;
  if (sprintId === "backlog") filter.sprintId = null;
  else if (sprintId) filter.sprintId = sprintId;
  if (status) filter.status = status;
  if (epicId) filter.epicId = epicId;
  const rows = await prisma.workItem.findMany({
    where: filter,
    include: {
      epic:    { select: { id: true, name: true, color: true } },
      sprint:  { select: { id: true, name: true, status: true } },
      release: { select: { id: true, name: true } },
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
  });
  res.json(rows);
});

agileRouter.get("/work-items/:id", itemPerms.read, async (req, res) => {
  const row = await prisma.workItem.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      workspace: { select: { id: true, key: true, name: true } },
      epic:      { select: { id: true, name: true, color: true } },
      sprint:    { select: { id: true, name: true, status: true } },
      release:   { select: { id: true, name: true } },
      parentItem:{ select: { id: true, key: true, title: true } },
      subItems:  { select: { id: true, key: true, title: true, status: true, points: true } },
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

agileRouter.post("/work-items", itemPerms.create, async (req, res) => {
  const parsed = itemUpsert.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const workspace = await prisma.agileWorkspace.findFirst({
    where: { id: parsed.data.workspaceId, tenantId },
  });
  if (!workspace) return res.status(400).json({ error: "Invalid workspace" });
  const key = await nextWorkItemKey(workspace.key, workspace.id);
  const row = await prisma.workItem.create({
    data: {
      workspaceId: workspace.id,
      tenantId,
      key,
      type: parsed.data.type,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      status: parsed.data.status ?? "Todo",
      priority: parsed.data.priority ?? "Medium",
      points: parsed.data.points ?? null,
      assigneeUserIds: parsed.data.assigneeUserIds ?? [],
      reporterUserId: parsed.data.reporterUserId ?? null,
      parentWorkItemId: parsed.data.parentWorkItemId ?? null,
      epicId: parsed.data.epicId ?? null,
      sprintId: parsed.data.sprintId ?? null,
      releaseId: parsed.data.releaseId ?? null,
      labels: parsed.data.labels ?? [],
      dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null,
      sortOrder: parsed.data.sortOrder ?? 0,
    },
  });
  res.status(201).json(row);
});

agileRouter.put("/work-items/:id", itemPerms.write, async (req, res) => {
  const parsed = itemUpsert.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.workItem.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const data: Record<string, unknown> = {};
  if (parsed.data.type !== undefined)             data.type = parsed.data.type;
  if (parsed.data.title !== undefined)            data.title = parsed.data.title;
  if (parsed.data.description !== undefined)      data.description = parsed.data.description;
  if (parsed.data.priority !== undefined)         data.priority = parsed.data.priority;
  if (parsed.data.points !== undefined)           data.points = parsed.data.points;
  if (parsed.data.assigneeUserIds !== undefined)  data.assigneeUserIds = parsed.data.assigneeUserIds;
  if (parsed.data.reporterUserId !== undefined)   data.reporterUserId = parsed.data.reporterUserId;
  if (parsed.data.parentWorkItemId !== undefined) data.parentWorkItemId = parsed.data.parentWorkItemId;
  if (parsed.data.epicId !== undefined)           data.epicId = parsed.data.epicId;
  if (parsed.data.sprintId !== undefined)         data.sprintId = parsed.data.sprintId;
  if (parsed.data.releaseId !== undefined)        data.releaseId = parsed.data.releaseId;
  if (parsed.data.labels !== undefined)           data.labels = parsed.data.labels;
  if (parsed.data.sortOrder !== undefined)        data.sortOrder = parsed.data.sortOrder;
  if (parsed.data.dueDate !== undefined)
    data.dueDate = parsed.data.dueDate ? new Date(parsed.data.dueDate) : null;
  if (parsed.data.status !== undefined) {
    data.status = parsed.data.status;
    if (parsed.data.status === "Done" && !existing.completedAt) data.completedAt = new Date();
    if (parsed.data.status !== "Done" && existing.completedAt) data.completedAt = null;
  }
  const row = await prisma.workItem.update({ where: { id: existing.id }, data });
  res.json(row);
});

agileRouter.delete("/work-items/:id", itemPerms.delete, async (req, res) => {
  const existing = await prisma.workItem.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: { _count: { select: { subItems: true } } },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing._count.subItems > 0)
    return res.status(400).json({ error: "Delete subtasks first" });
  await prisma.workItem.delete({ where: { id: existing.id } });
  res.status(204).send();
});

/* ────────────────────────────── BACKLOG + BOARD ───────────────────────── */

// Backlog = items with sprintId null. Grouped by epic for the UI.
agileRouter.get("/backlog", itemPerms.read, async (req, res) => {
  const workspaceId = typeof req.query.workspaceId === "string" ? req.query.workspaceId : undefined;
  if (!workspaceId) return res.status(400).json({ error: "workspaceId is required" });
  await assertWorkspace(workspaceId, req.auth!.tenantId);
  const items = await prisma.workItem.findMany({
    where: { workspaceId, sprintId: null, status: { not: "Cancelled" } },
    include: { epic: { select: { id: true, name: true, color: true } } },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
  });
  res.json({
    total: items.length,
    totalPoints: items.reduce((s, i) => s + (i.points ?? 0), 0),
    items,
  });
});

// Board = items in a given sprint grouped by status. If no sprintId, uses
// the active sprint for the workspace.
agileRouter.get("/board", itemPerms.read, async (req, res) => {
  const workspaceId = typeof req.query.workspaceId === "string" ? req.query.workspaceId : undefined;
  if (!workspaceId) return res.status(400).json({ error: "workspaceId is required" });
  await assertWorkspace(workspaceId, req.auth!.tenantId);
  let sprintId = typeof req.query.sprintId === "string" ? req.query.sprintId : undefined;
  if (!sprintId) {
    const active = await prisma.sprint.findFirst({
      where: { workspaceId, status: "Active" },
      orderBy: { actualStartAt: "desc" },
    });
    sprintId = active?.id;
  }
  if (!sprintId) return res.json({ sprint: null, columns: [] });
  const sprint = await prisma.sprint.findFirst({ where: { id: sprintId, workspaceId } });
  if (!sprint) return res.status(404).json({ error: "Sprint not found" });
  const items = await prisma.workItem.findMany({
    where: { sprintId },
    include: { epic: { select: { id: true, name: true, color: true } } },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
  });
  const statuses = ["Todo", "InProgress", "InReview", "Done"] as const;
  const columns = statuses.map((status) => ({
    status,
    items: items.filter((i) => i.status === status),
  }));
  res.json({ sprint, columns });
});

// Move a work item — sprint change, status change, or reorder within column.
agileRouter.post("/work-items/:id/move", itemPerms.write, async (req, res) => {
  const parsed = z
    .object({
      sprintId: z.string().nullable().optional(),
      status: z.enum(["Todo", "InProgress", "InReview", "Done", "Cancelled"]).optional(),
      sortOrder: z.coerce.number().int().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.workItem.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const data: Record<string, unknown> = {};
  if (parsed.data.sprintId !== undefined)  data.sprintId = parsed.data.sprintId;
  if (parsed.data.sortOrder !== undefined) data.sortOrder = parsed.data.sortOrder;
  if (parsed.data.status !== undefined) {
    data.status = parsed.data.status;
    if (parsed.data.status === "Done" && !existing.completedAt) data.completedAt = new Date();
    if (parsed.data.status !== "Done" && existing.completedAt) data.completedAt = null;
  }
  const row = await prisma.workItem.update({ where: { id: existing.id }, data });
  res.json(row);
});

/* ─────────────────────────────── BURNDOWN ─────────────────────────────── */

// Burndown: for each day of the sprint, compute remaining (open) story points.
// Uses completedAt to figure out when points burned. Days without data
// interpolate to the previous day's value.
agileRouter.get("/sprints/:id/burndown", sprintPerms.read, async (req, res) => {
  const sprint = await prisma.sprint.findFirst({
    where: { id: req.params.id, workspace: { tenantId: req.auth!.tenantId } },
    include: { workItems: true },
  });
  if (!sprint) return res.status(404).json({ error: "Not found" });
  const totalPoints = sprint.workItems.reduce((s, i) => s + (i.points ?? 0), 0);
  const start = sprint.startDate ?? sprint.actualStartAt ?? sprint.createdAt;
  const end = sprint.endDate ?? sprint.actualEndAt ?? new Date();
  const startMs = new Date(start).setHours(0, 0, 0, 0);
  const endMs = new Date(end).setHours(0, 0, 0, 0);
  const days = Math.max(1, Math.ceil((endMs - startMs) / 86_400_000) + 1);
  const series: { date: string; remaining: number; ideal: number }[] = [];
  for (let d = 0; d < days; d++) {
    const cur = new Date(startMs + d * 86_400_000);
    const cutoff = cur.getTime() + 86_400_000; // end of that day
    const burned = sprint.workItems
      .filter((i) => i.completedAt && new Date(i.completedAt).getTime() < cutoff)
      .reduce((s, i) => s + (i.points ?? 0), 0);
    const remaining = Math.max(0, totalPoints - burned);
    const ideal = Math.max(0, Math.round(totalPoints - (totalPoints * d) / Math.max(1, days - 1)));
    series.push({ date: cur.toISOString().slice(0, 10), remaining, ideal });
  }
  const done = sprint.workItems.filter((i) => i.status === "Done").length;
  res.json({
    sprint: { id: sprint.id, name: sprint.name, status: sprint.status },
    totalPoints,
    completedPoints: totalPoints - (series[series.length - 1]?.remaining ?? totalPoints),
    totalItems: sprint.workItems.length,
    doneItems: done,
    series,
  });
});

// Velocity for a workspace = completed points per completed sprint (last 10).
agileRouter.get("/velocity", sprintPerms.read, async (req, res) => {
  const workspaceId = typeof req.query.workspaceId === "string" ? req.query.workspaceId : undefined;
  if (!workspaceId) return res.status(400).json({ error: "workspaceId is required" });
  await assertWorkspace(workspaceId, req.auth!.tenantId);
  const sprints = await prisma.sprint.findMany({
    where: { workspaceId, status: "Completed" },
    include: { workItems: true },
    orderBy: { actualEndAt: "desc" },
    take: 10,
  });
  const series = sprints
    .slice()
    .reverse()
    .map((s) => ({
      id: s.id,
      name: s.name,
      completedPoints: s.workItems
        .filter((i) => i.status === "Done")
        .reduce((sum, i) => sum + (i.points ?? 0), 0),
      totalPoints: s.workItems.reduce((sum, i) => sum + (i.points ?? 0), 0),
    }));
  const avg =
    series.length > 0
      ? Math.round(series.reduce((s, x) => s + x.completedPoints, 0) / series.length)
      : 0;
  res.json({ averageVelocity: avg, series });
});

/* ────────────────────────────────── OKRS ──────────────────────────────── */

const okrUpsert = z.object({
  workspaceId: z.string().min(1),
  objective: z.string().min(1).max(240),
  description: z.string().nullable().optional(),
  ownerUserId: z.string().nullable().optional(),
  period: z.string().min(1).max(30),
  status: z.enum(["OnTrack", "AtRisk", "OffTrack", "Completed"]).optional(),
  keyResults: z
    .array(
      z.object({
        id: z.string().optional(),
        title: z.string().min(1).max(240),
        targetValue: z.coerce.number(),
        currentValue: z.coerce.number().optional(),
        unit: z.string().nullable().optional(),
        sortOrder: z.coerce.number().int().optional(),
      }),
    )
    .optional(),
});

function computeOkrProgress(krs: { targetValue: number; currentValue: number }[]) {
  if (!krs.length) return 0;
  const total = krs.reduce((s, k) => {
    const t = Number(k.targetValue) || 0;
    const c = Number(k.currentValue) || 0;
    if (t <= 0) return s + (c > 0 ? 1 : 0);
    return s + Math.max(0, Math.min(1, c / t));
  }, 0);
  return Math.round((total / krs.length) * 100);
}

agileRouter.get("/okrs", okrPerms.read, async (req, res) => {
  const workspaceId = typeof req.query.workspaceId === "string" ? req.query.workspaceId : undefined;
  const period = typeof req.query.period === "string" ? req.query.period : undefined;
  if (!workspaceId) return res.status(400).json({ error: "workspaceId is required" });
  await assertWorkspace(workspaceId, req.auth!.tenantId);
  const rows = await prisma.okr.findMany({
    where: { workspaceId, ...(period ? { period } : {}) },
    include: { keyResults: { orderBy: { sortOrder: "asc" } } },
    orderBy: [{ period: "desc" }, { createdAt: "desc" }],
  });
  const out = rows.map((r) => ({
    ...r,
    progress: computeOkrProgress(
      r.keyResults.map((k) => ({ targetValue: Number(k.targetValue), currentValue: Number(k.currentValue) })),
    ),
  }));
  res.json(out);
});

agileRouter.get("/okrs/:id", okrPerms.read, async (req, res) => {
  const row = await prisma.okr.findFirst({
    where: { id: req.params.id, workspace: { tenantId: req.auth!.tenantId } },
    include: { keyResults: { orderBy: { sortOrder: "asc" } } },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json({
    ...row,
    progress: computeOkrProgress(
      row.keyResults.map((k) => ({ targetValue: Number(k.targetValue), currentValue: Number(k.currentValue) })),
    ),
  });
});

agileRouter.post("/okrs", okrPerms.create, async (req, res) => {
  const parsed = okrUpsert.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  await assertWorkspace(parsed.data.workspaceId, req.auth!.tenantId).catch((e) => {
    res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
    throw e;
  });
  const row = await prisma.okr.create({
    data: {
      workspaceId: parsed.data.workspaceId,
      objective: parsed.data.objective,
      description: parsed.data.description ?? null,
      ownerUserId: parsed.data.ownerUserId ?? null,
      period: parsed.data.period,
      status: parsed.data.status ?? "OnTrack",
      keyResults: parsed.data.keyResults
        ? {
            create: parsed.data.keyResults.map((k, idx) => ({
              title: k.title,
              targetValue: k.targetValue,
              currentValue: k.currentValue ?? 0,
              unit: k.unit ?? null,
              sortOrder: k.sortOrder ?? idx,
            })),
          }
        : undefined,
    },
    include: { keyResults: { orderBy: { sortOrder: "asc" } } },
  });
  res.status(201).json(row);
});

agileRouter.put("/okrs/:id", okrPerms.write, async (req, res) => {
  const parsed = okrUpsert.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.okr.findFirst({
    where: { id: req.params.id, workspace: { tenantId: req.auth!.tenantId } },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const data: Record<string, unknown> = {};
  if (parsed.data.objective !== undefined)   data.objective = parsed.data.objective;
  if (parsed.data.description !== undefined) data.description = parsed.data.description;
  if (parsed.data.ownerUserId !== undefined) data.ownerUserId = parsed.data.ownerUserId;
  if (parsed.data.period !== undefined)      data.period = parsed.data.period;
  if (parsed.data.status !== undefined)      data.status = parsed.data.status;
  const row = await prisma.okr.update({ where: { id: existing.id }, data });
  // Replace-all key results if provided.
  if (parsed.data.keyResults) {
    await prisma.$transaction([
      prisma.keyResult.deleteMany({ where: { okrId: existing.id } }),
      prisma.keyResult.createMany({
        data: parsed.data.keyResults.map((k, idx) => ({
          okrId: existing.id,
          title: k.title,
          targetValue: k.targetValue,
          currentValue: k.currentValue ?? 0,
          unit: k.unit ?? null,
          sortOrder: k.sortOrder ?? idx,
        })),
      }),
    ]);
  }
  const full = await prisma.okr.findUnique({
    where: { id: row.id },
    include: { keyResults: { orderBy: { sortOrder: "asc" } } },
  });
  res.json(full);
});

// Bump a single KeyResult's currentValue — Zoho-style progress update.
agileRouter.post("/key-results/:id/progress", okrPerms.write, async (req, res) => {
  const parsed = z.object({ currentValue: z.coerce.number() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const kr = await prisma.keyResult.findFirst({
    where: { id: req.params.id, okr: { workspace: { tenantId: req.auth!.tenantId } } },
  });
  if (!kr) return res.status(404).json({ error: "Not found" });
  const row = await prisma.keyResult.update({
    where: { id: kr.id },
    data: { currentValue: parsed.data.currentValue },
  });
  res.json(row);
});

agileRouter.delete("/okrs/:id", okrPerms.delete, async (req, res) => {
  const existing = await prisma.okr.findFirst({
    where: { id: req.params.id, workspace: { tenantId: req.auth!.tenantId } },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.okr.delete({ where: { id: existing.id } });
  res.status(204).send();
});
