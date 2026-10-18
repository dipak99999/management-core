import { Router } from "express";
import { z } from "zod";
import { nextName, prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// Issue tracker — engineering bugs/tasks scoped to a Project. Distinct
// from DeskTicket (customer support). Rolls up to Sprint / Release.

export const issueRouter = Router();
const p = perms("Issue");

const STATUSES = ["Open", "InProgress", "InReview", "Resolved", "Closed", "WontFix"] as const;

const upsertSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().min(1).max(300),
  description: z.string().optional().nullable(),
  priority: z.enum(["Low", "Medium", "High", "Critical"]).default("Medium"),
  severity: z.enum(["Minor", "Major", "Blocker"]).default("Minor"),
  issueType: z.enum(["Bug", "Enhancement", "Task", "Question"]).default("Bug"),
  status: z.enum(STATUSES).optional(),
  assignedEmployeeId: z.string().optional().nullable(),
  sprintId: z.string().optional().nullable(),
  releaseId: z.string().optional().nullable(),
  environment: z.string().optional().nullable(),
  reproSteps: z.string().optional().nullable(),
  labels: z.array(z.string()).default([]),
  dueDate: z.string().optional().nullable(),
});

issueRouter.get("/", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const assignedEmployeeId =
    typeof req.query.assignedEmployeeId === "string" ? req.query.assignedEmployeeId : undefined;
  const sprintId = typeof req.query.sprintId === "string" ? req.query.sprintId : undefined;

  const rows = await prisma.issue.findMany({
    where: {
      tenantId,
      ...(projectId ? { projectId } : {}),
      ...(status ? { status } : {}),
      ...(assignedEmployeeId ? { assignedEmployeeId } : {}),
      ...(sprintId ? { sprintId } : {}),
    },
    include: {
      project: { select: { projectName: true, name: true } },
      assignedEmployee: { select: { employeeName: true, employeeCode: true } },
    },
    orderBy: [{ status: "asc" }, { priority: "desc" }, { createdAt: "desc" }],
    take: 500,
  });
  res.json(rows);
});

issueRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.issue.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      project: { select: { projectName: true, name: true } },
      assignedEmployee: { select: { employeeName: true, employeeCode: true } },
      sprint: { select: { name: true, status: true } },
      release: { select: { name: true, status: true } },
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

issueRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const d = parsed.data;
  const tenantId = req.auth!.tenantId;
  // Verify project belongs to this tenant.
  const proj = await prisma.project.findFirst({
    where: { id: d.projectId, tenantId },
    select: { id: true },
  });
  if (!proj) return res.status(400).json({ error: "projectId not found in tenant" });

  const name = await nextName(prisma, tenantId, "ISSUE-");
  const row = await prisma.issue.create({
    data: {
      tenantId,
      name,
      projectId: d.projectId,
      title: d.title,
      description: d.description ?? null,
      priority: d.priority,
      severity: d.severity,
      issueType: d.issueType,
      status: d.status ?? "Open",
      reporterUserId: req.auth!.userId,
      assignedEmployeeId: d.assignedEmployeeId ?? null,
      sprintId: d.sprintId ?? null,
      releaseId: d.releaseId ?? null,
      environment: d.environment ?? null,
      reproSteps: d.reproSteps ?? null,
      labels: d.labels,
      dueDate: d.dueDate ? new Date(d.dueDate) : null,
    },
  });
  res.status(201).json(row);
});

issueRouter.put("/:id", p.write, async (req, res) => {
  const parsed = upsertSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.issue.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const d = parsed.data;
  const closingNow =
    d.status && (d.status === "Closed" || d.status === "Resolved" || d.status === "WontFix") &&
    !(existing.status === "Closed" || existing.status === "Resolved" || existing.status === "WontFix");
  const row = await prisma.issue.update({
    where: { id: existing.id },
    data: {
      ...(d.title !== undefined ? { title: d.title } : {}),
      ...(d.description !== undefined ? { description: d.description } : {}),
      ...(d.priority !== undefined ? { priority: d.priority } : {}),
      ...(d.severity !== undefined ? { severity: d.severity } : {}),
      ...(d.issueType !== undefined ? { issueType: d.issueType } : {}),
      ...(d.status !== undefined ? { status: d.status } : {}),
      ...(d.assignedEmployeeId !== undefined
        ? { assignedEmployeeId: d.assignedEmployeeId ?? null }
        : {}),
      ...(d.sprintId !== undefined ? { sprintId: d.sprintId ?? null } : {}),
      ...(d.releaseId !== undefined ? { releaseId: d.releaseId ?? null } : {}),
      ...(d.environment !== undefined ? { environment: d.environment ?? null } : {}),
      ...(d.reproSteps !== undefined ? { reproSteps: d.reproSteps ?? null } : {}),
      ...(d.labels !== undefined ? { labels: d.labels } : {}),
      ...(d.dueDate !== undefined ? { dueDate: d.dueDate ? new Date(d.dueDate) : null } : {}),
      ...(closingNow ? { closedAt: new Date() } : {}),
    },
  });
  res.json(row);
});

issueRouter.delete("/:id", p.delete, async (req, res) => {
  const existing = await prisma.issue.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.issue.delete({ where: { id: existing.id } });
  res.status(204).send();
});
