import { Router } from "express";
import { z } from "zod";
import { prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// Module 51 — Employee Onboarding + Separation routes.
//
// Both flows share the same task-based structure so we mount them in
// one router file with distinct URL prefixes for clarity in the audit
// log. Auto-complete when every task is Completed or Skipped.

export const employeeOnboardingRouter = Router();
export const employeeSeparationRouter = Router();
const p = perms("Employee");

const DEFAULT_ONBOARDING_TASKS = [
  "Setup workstation + credentials",
  "Sign NDA + employment contract",
  "HR orientation session",
  "Assign mentor",
  "IT: create email + access badges",
  "Payroll: collect KYC + bank details",
  "Book first 1:1 with manager",
];

const DEFAULT_SEPARATION_TASKS = [
  "Exit interview",
  "Return company assets (laptop, badge, keys)",
  "Handover documentation",
  "Revoke system access",
  "Final salary + F&F settlement",
  "PF / gratuity settlement",
  "Issue relieving letter",
];

const taskSchema = z.object({
  sequence: z.coerce.number().int().min(1),
  taskName: z.string().min(1).max(200),
  assignedTo: z.string().max(200).optional().nullable(),
  dueDate: z.string().datetime().optional().nullable(),
});

const onboardingSchema = z.object({
  employeeId: z.string().min(1),
  boardingDate: z.string().datetime(),
  notes: z.string().max(1000).optional().nullable(),
  tasks: z.array(taskSchema).optional(), // omit → seed defaults
});

const separationSchema = z.object({
  employeeId: z.string().min(1),
  separationDate: z.string().datetime(),
  reason: z.string().max(100).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  tasks: z.array(taskSchema).optional(),
});

const taskUpdateSchema = z.object({
  status: z.enum(["Pending", "InProgress", "Completed", "Skipped"]).optional(),
  assignedTo: z.string().max(200).optional().nullable(),
  dueDate: z.string().datetime().optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

// ---------- Onboarding ----------

employeeOnboardingRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.employeeOnboarding.findMany({
    where: { tenantId: req.auth!.tenantId },
    include: {
      employee: { select: { employeeCode: true, employeeName: true } },
      _count: { select: { tasks: true } },
    },
    orderBy: { boardingDate: "desc" },
  });
  res.json(rows);
});

employeeOnboardingRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.employeeOnboarding.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      employee: true,
      tasks: { orderBy: { sequence: "asc" } },
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

employeeOnboardingRouter.post("/", p.create, async (req, res) => {
  const parsed = onboardingSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;
  const tenantId = req.auth!.tenantId;

  const emp = await prisma.employee.findFirst({ where: { id: b.employeeId, tenantId } });
  if (!emp) return res.status(400).json({ error: "Employee not found" });

  const tasks =
    b.tasks && b.tasks.length > 0
      ? b.tasks
      : DEFAULT_ONBOARDING_TASKS.map((name, i) => ({
          sequence: i + 1,
          taskName: name,
          assignedTo: null as string | null,
          dueDate: null as string | null,
        }));

  try {
    const row = await prisma.employeeOnboarding.create({
      data: {
        tenantId,
        employeeId: b.employeeId,
        boardingDate: new Date(b.boardingDate),
        status: "Draft",
        notes: b.notes ?? null,
        tasks: {
          create: tasks.map((t) => ({
            sequence: t.sequence,
            taskName: t.taskName,
            assignedTo: t.assignedTo ?? null,
            dueDate: t.dueDate ? new Date(t.dueDate) : null,
          })),
        },
      },
      include: { tasks: true },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint")) {
      return res.status(409).json({ error: "This employee already has an onboarding record" });
    }
    throw e;
  }
});

employeeOnboardingRouter.post("/:id/start", p.submit, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const row = await prisma.employeeOnboarding.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  if (row.status !== "Draft") return res.status(400).json({ error: `Cannot start in status ${row.status}` });
  const updated = await prisma.employeeOnboarding.update({
    where: { id: row.id },
    data: { status: "InProgress" },
  });
  res.json(updated);
});

employeeOnboardingRouter.post("/:id/tasks/:taskId", p.write, async (req, res) => {
  const parsed = taskUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;

  const row = await prisma.employeeOnboarding.findFirst({
    where: { id: req.params.id, tenantId },
    include: { tasks: true },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  const task = row.tasks.find((t) => t.id === req.params.taskId);
  if (!task) return res.status(404).json({ error: "Task not found" });

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.employeeOnboardingTask.update({
      where: { id: task.id },
      data: {
        ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
        ...(parsed.data.assignedTo !== undefined ? { assignedTo: parsed.data.assignedTo } : {}),
        ...(parsed.data.dueDate !== undefined
          ? { dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null }
          : {}),
        ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes } : {}),
        ...(parsed.data.status === "Completed" ? { completedAt: new Date() } : {}),
      },
    });
    const all = await tx.employeeOnboardingTask.findMany({
      where: { onboardingId: row.id },
      select: { status: true },
    });
    const allDone = all.every((t) => t.status === "Completed" || t.status === "Skipped");
    if (allDone && row.status === "InProgress") {
      await tx.employeeOnboarding.update({
        where: { id: row.id },
        data: { status: "Completed" },
      });
    }
    return updated;
  });
  res.json(result);
});

// ---------- Separation ----------

employeeSeparationRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.employeeSeparation.findMany({
    where: { tenantId: req.auth!.tenantId },
    include: {
      employee: { select: { employeeCode: true, employeeName: true } },
      _count: { select: { tasks: true } },
    },
    orderBy: { separationDate: "desc" },
  });
  res.json(rows);
});

employeeSeparationRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.employeeSeparation.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      employee: true,
      tasks: { orderBy: { sequence: "asc" } },
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

employeeSeparationRouter.post("/", p.create, async (req, res) => {
  const parsed = separationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;
  const tenantId = req.auth!.tenantId;

  const emp = await prisma.employee.findFirst({ where: { id: b.employeeId, tenantId } });
  if (!emp) return res.status(400).json({ error: "Employee not found" });

  const tasks =
    b.tasks && b.tasks.length > 0
      ? b.tasks
      : DEFAULT_SEPARATION_TASKS.map((name, i) => ({
          sequence: i + 1,
          taskName: name,
          assignedTo: null as string | null,
          dueDate: null as string | null,
        }));

  try {
    const row = await prisma.employeeSeparation.create({
      data: {
        tenantId,
        employeeId: b.employeeId,
        separationDate: new Date(b.separationDate),
        reason: b.reason ?? null,
        status: "Draft",
        notes: b.notes ?? null,
        tasks: {
          create: tasks.map((t) => ({
            sequence: t.sequence,
            taskName: t.taskName,
            assignedTo: t.assignedTo ?? null,
            dueDate: t.dueDate ? new Date(t.dueDate) : null,
          })),
        },
      },
      include: { tasks: true },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint")) {
      return res.status(409).json({ error: "This employee already has a separation record" });
    }
    throw e;
  }
});

employeeSeparationRouter.post("/:id/start", p.submit, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const row = await prisma.employeeSeparation.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  if (row.status !== "Draft") return res.status(400).json({ error: `Cannot start in status ${row.status}` });
  const updated = await prisma.employeeSeparation.update({
    where: { id: row.id },
    data: { status: "InProgress" },
  });
  res.json(updated);
});

employeeSeparationRouter.post("/:id/tasks/:taskId", p.write, async (req, res) => {
  const parsed = taskUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;

  const row = await prisma.employeeSeparation.findFirst({
    where: { id: req.params.id, tenantId },
    include: { tasks: true },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  const task = row.tasks.find((t) => t.id === req.params.taskId);
  if (!task) return res.status(404).json({ error: "Task not found" });

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.employeeSeparationTask.update({
      where: { id: task.id },
      data: {
        ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
        ...(parsed.data.assignedTo !== undefined ? { assignedTo: parsed.data.assignedTo } : {}),
        ...(parsed.data.dueDate !== undefined
          ? { dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null }
          : {}),
        ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes } : {}),
        ...(parsed.data.status === "Completed" ? { completedAt: new Date() } : {}),
      },
    });
    const all = await tx.employeeSeparationTask.findMany({
      where: { separationId: row.id },
      select: { status: true },
    });
    const allDone = all.every((t) => t.status === "Completed" || t.status === "Skipped");
    if (allDone && row.status === "InProgress") {
      await tx.employeeSeparation.update({
        where: { id: row.id },
        data: { status: "Completed" },
      });
    }
    return updated;
  });
  res.json(result);
});
