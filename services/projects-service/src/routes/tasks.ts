import { Router } from "express";
import { z } from "zod";
import {
  canTransitionTask,
  prisma,
  summarizeDependencyReadiness,
  validateCustomData,
  type FromTaskStatusMap,
  type TaskDependencyLike,
  type TaskDependencyType,
  type TaskStatus,
} from "@lumaara/db";
import { perms, publishRealtime } from "@lumaara/service-auth";

export const taskRouter = Router();

const p = perms("Task");

const upsertSchema = z.object({
  projectId: z.string().min(1),
  subject: z.string().min(1).max(200),
  description: z.string().optional().nullable(),
  status: z.enum(["Open", "InProgress", "Completed", "Cancelled"]).default("Open"),
  priority: z.enum(["Low", "Medium", "High", "Urgent"]).default("Medium"),
  assignedEmployeeId: z.string().optional().nullable(),
  startDate: z.string().datetime().optional().nullable(),
  endDate: z.string().datetime().optional().nullable(),
  expectedHours: z.coerce.number().nonnegative().default(0),
  sortOrder: z.coerce.number().int().default(0),
  customData: z.record(z.unknown()).optional().nullable(),
  // Projects-Plus additions.
  parentTaskId: z.string().nullable().optional(),
  milestoneId:  z.string().nullable().optional(),
  progressPct:  z.number().int().min(0).max(100).optional(),
  weight:       z.number().int().positive().optional(),
});

taskRouter.get("/", p.read, async (req, res) => {
  const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
  const assignedTo = typeof req.query.assignedEmployeeId === "string"
    ? req.query.assignedEmployeeId
    : undefined;
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const rows = await prisma.task.findMany({
    where: {
      tenantId: req.auth!.tenantId,
      ...(projectId ? { projectId } : {}),
      ...(assignedTo ? { assignedEmployeeId: assignedTo } : {}),
      ...(status ? { status } : {}),
    },
    include: {
      project: { select: { id: true, name: true, projectName: true } },
      assignedEmployee: { select: { id: true, employeeCode: true, employeeName: true } },
    },
    orderBy: [{ projectId: "asc" }, { sortOrder: "asc" }],
  });
  res.json(rows);
});

// D+: dependency-readiness snapshot. UI uses this to render a "blocked
// by N tasks" chip on the task detail without loading the full dep
// graph client-side. Cheap — one findMany for deps + one for fromTasks.
// Registered BEFORE the parametric GET /:id so /:id/dependency-status
// resolves cleanly.
taskRouter.get("/:id/dependency-status", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const task = await prisma.task.findFirst({
    where: { id: req.params.id, tenantId },
    select: { id: true, status: true },
  });
  if (!task) return res.status(404).json({ error: "Not found" });
  const deps = await prisma.taskDependency.findMany({
    where: { toTaskId: task.id, fromTask: { tenantId } },
    select: { fromTaskId: true, type: true },
  });
  if (deps.length === 0) {
    return res.json({
      taskId: task.id,
      currentStatus: task.status,
      readyToStart: true,
      readyToComplete: true,
      startBlockers: [],
      completeBlockers: [],
    });
  }
  const fromTasks = await prisma.task.findMany({
    where: { tenantId, id: { in: deps.map((d) => d.fromTaskId) } },
    select: { id: true, status: true },
  });
  const statuses: FromTaskStatusMap = {};
  for (const t of fromTasks) statuses[t.id] = t.status as TaskStatus;
  const summary = summarizeDependencyReadiness(
    deps.map(
      (d): TaskDependencyLike => ({
        fromTaskId: d.fromTaskId,
        type: d.type as TaskDependencyType,
      }),
    ),
    statuses,
  );
  res.json({
    taskId: task.id,
    currentStatus: task.status,
    ...summary,
  });
});

taskRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.task.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      project: true,
      assignedEmployee: true,
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

taskRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;

  const project = await prisma.project.findFirst({
    where: { id: parsed.data.projectId, tenantId },
  });
  if (!project) return res.status(400).json({ error: "Invalid project" });
  if (parsed.data.assignedEmployeeId) {
    const emp = await prisma.employee.findFirst({
      where: { id: parsed.data.assignedEmployeeId, tenantId },
    });
    if (!emp) return res.status(400).json({ error: "Invalid assignee" });
  }

  let customData;
  try {
    customData = await validateCustomData(
      prisma,
      tenantId,
      "Task",
      (parsed.data.customData as Record<string, unknown> | undefined) ?? undefined,
    );
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
  }
  const row = await prisma.task.create({
    data: {
      tenantId,
      projectId: parsed.data.projectId,
      subject: parsed.data.subject,
      description: parsed.data.description ?? null,
      status: parsed.data.status,
      priority: parsed.data.priority,
      assignedEmployeeId: parsed.data.assignedEmployeeId ?? null,
      startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : null,
      endDate: parsed.data.endDate ? new Date(parsed.data.endDate) : null,
      expectedHours: parsed.data.expectedHours,
      sortOrder: parsed.data.sortOrder,
      customData: customData ?? undefined,
      parentTaskId: parsed.data.parentTaskId ?? null,
      milestoneId: parsed.data.milestoneId ?? null,
      progressPct: parsed.data.progressPct ?? 0,
      weight: parsed.data.weight ?? 1,
    },
    include: {
      project: { select: { id: true, name: true, projectName: true } },
      assignedEmployee: { select: { id: true, employeeCode: true, employeeName: true } },
    },
  });
  res.status(201).json(row);
});

taskRouter.put("/:id", p.write, async (req, res) => {
  const parsed = upsertSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const existing = await prisma.task.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });

  // Dependency guard — when status is transitioning to InProgress or
  // Completed, refuse if any inbound dep (fromTask → thisTask) hasn't
  // reached the state required by its type (FS/SS/FF/SF). Reopen (Open)
  // and Cancel are always allowed and skip this block.
  const nextStatus = parsed.data.status as TaskStatus | undefined;
  if (
    nextStatus &&
    nextStatus !== existing.status &&
    (nextStatus === "InProgress" || nextStatus === "Completed")
  ) {
    const deps = await prisma.taskDependency.findMany({
      where: { toTaskId: existing.id, fromTask: { tenantId } },
      select: { fromTaskId: true, type: true },
    });
    if (deps.length > 0) {
      const fromTasks = await prisma.task.findMany({
        where: {
          tenantId,
          id: { in: deps.map((d) => d.fromTaskId) },
        },
        select: { id: true, status: true },
      });
      const statuses: FromTaskStatusMap = {};
      for (const t of fromTasks) statuses[t.id] = t.status as TaskStatus;
      const check = canTransitionTask(
        nextStatus,
        deps.map(
          (d): TaskDependencyLike => ({
            fromTaskId: d.fromTaskId,
            type: d.type as TaskDependencyType,
          }),
        ),
        statuses,
      );
      if (!check.allowed) {
        return res.status(400).json({
          error: `Cannot transition to ${nextStatus} — ${check.blockers.length} dependency blocker${check.blockers.length === 1 ? "" : "s"}`,
          blockers: check.blockers,
        });
      }
    }
  }

  let customData;
  if (parsed.data.customData !== undefined) {
    try {
      customData = await validateCustomData(
        prisma,
        tenantId,
        "Task",
        parsed.data.customData as Record<string, unknown> | null,
        { docId: existing.id },
      );
    } catch (e) {
      return res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
    }
  }
  const { customData: _drop, ...rest } = parsed.data;
  const row = await prisma.task.update({
    where: { id: existing.id },
    data: {
      ...rest,
      startDate:
        rest.startDate !== undefined
          ? rest.startDate
            ? new Date(rest.startDate)
            : null
          : undefined,
      endDate:
        rest.endDate !== undefined
          ? rest.endDate
            ? new Date(rest.endDate)
            : null
          : undefined,
      ...(parsed.data.customData !== undefined ? { customData: customData ?? undefined } : {}),
    },
  });
  void publishRealtime(req.auth!.tenantId, "task", { id: row.id, status: row.status });
  res.json(row);
});

taskRouter.delete("/:id", p.delete, async (req, res) => {
  const existing = await prisma.task.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: { _count: { select: { timesheetLines: true } } },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing._count.timesheetLines > 0)
    return res
      .status(400)
      .json({ error: "Cannot delete: timesheet lines reference this task" });
  await prisma.task.delete({ where: { id: existing.id } });
  res.status(204).send();
});
