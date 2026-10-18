import { Router } from "express";
import { z } from "zod";
import { prisma, nextName, validateCustomData } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

export const projectRouter = Router();

const p = perms("Project");

const upsertSchema = z.object({
  projectName: z.string().min(1).max(120),
  customerId: z.string().optional().nullable(),
  projectManagerId: z.string().optional().nullable(),
  startDate: z.string().datetime().optional().nullable(),
  endDate: z.string().datetime().optional().nullable(),
  status: z.enum(["Open", "Completed", "Cancelled"]).default("Open"),
  billingType: z.enum(["Fixed", "Hourly", "Non-billable"]).default("Non-billable"),
  estimatedCost: z.coerce.number().nonnegative().default(0),
  notes: z.string().optional().nullable(),
  customData: z.record(z.unknown()).optional().nullable(),
  // Projects-Plus additions — budget tracking.
  budgetAmount: z.coerce.number().nonnegative().optional(),
  budgetThresholdPct: z.coerce.number().int().min(0).max(100).optional(),
});

projectRouter.get("/", p.read, async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const rows = await prisma.project.findMany({
    where: {
      tenantId: req.auth!.tenantId,
      ...(status ? { status } : {}),
    },
    include: {
      customer: { select: { id: true, customerName: true } },
      projectManager: { select: { id: true, employeeName: true, employeeCode: true } },
      _count: { select: { tasks: true } },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });
  res.json(rows);
});

projectRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.project.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      customer: true,
      projectManager: { select: { id: true, employeeCode: true, employeeName: true } },
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

// Full detail: project + tasks + timesheet-hours rollup per task.
projectRouter.get("/:id/full", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const project = await prisma.project.findFirst({
    where: { id: req.params.id, tenantId },
    include: {
      customer: true,
      projectManager: { select: { id: true, employeeCode: true, employeeName: true } },
      tasks: {
        orderBy: { sortOrder: "asc" },
        include: {
          assignedEmployee: { select: { id: true, employeeCode: true, employeeName: true } },
        },
      },
    },
  });
  if (!project) return res.status(404).json({ error: "Not found" });

  // Recent timesheet activity against this project (last 30 rows).
  const recentLines = await prisma.timesheetLine.findMany({
    where: { projectId: project.id, timesheet: { tenantId } },
    include: {
      timesheet: {
        select: {
          id: true,
          name: true,
          status: true,
          employee: { select: { id: true, employeeCode: true, employeeName: true } },
        },
      },
      task: { select: { id: true, subject: true } },
    },
    orderBy: { date: "desc" },
    take: 30,
  });

  const stats = {
    totalTasks: project.tasks.length,
    openTasks: project.tasks.filter((t) => t.status === "Open" || t.status === "InProgress").length,
    completedTasks: project.tasks.filter((t) => t.status === "Completed").length,
    plannedHours: project.tasks.reduce((s, t) => s + Number(t.expectedHours), 0),
    loggedHours: project.tasks.reduce((s, t) => s + Number(t.actualHours), 0),
  };

  res.json({ project, stats, recentLines });
});

projectRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;

  if (parsed.data.customerId) {
    const c = await prisma.customer.findFirst({
      where: { id: parsed.data.customerId, tenantId },
    });
    if (!c) return res.status(400).json({ error: "Invalid customer" });
  }
  if (parsed.data.projectManagerId) {
    const e = await prisma.employee.findFirst({
      where: { id: parsed.data.projectManagerId, tenantId },
    });
    if (!e) return res.status(400).json({ error: "Invalid project manager" });
  }

  let customData;
  try {
    customData = await validateCustomData(
      prisma,
      tenantId,
      "Project",
      (parsed.data.customData as Record<string, unknown> | undefined) ?? undefined,
    );
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
  }

  const name = await nextName(prisma, tenantId, "PROJ-");
  const row = await prisma.project.create({
    data: {
      tenantId,
      name,
      projectName: parsed.data.projectName,
      customerId: parsed.data.customerId ?? null,
      projectManagerId: parsed.data.projectManagerId ?? null,
      startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : null,
      endDate: parsed.data.endDate ? new Date(parsed.data.endDate) : null,
      status: parsed.data.status,
      billingType: parsed.data.billingType,
      estimatedCost: parsed.data.estimatedCost,
      budgetAmount: parsed.data.budgetAmount ?? 0,
      budgetThresholdPct: parsed.data.budgetThresholdPct ?? 80,
      notes: parsed.data.notes ?? null,
      customData: customData ?? undefined,
    },
  });
  res.status(201).json(row);
});

projectRouter.put("/:id", p.write, async (req, res) => {
  const parsed = upsertSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const existing = await prisma.project.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  let customData;
  if (parsed.data.customData !== undefined) {
    try {
      customData = await validateCustomData(
        prisma,
        tenantId,
        "Project",
        parsed.data.customData as Record<string, unknown> | null,
        { docId: existing.id },
      );
    } catch (e) {
      return res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
    }
  }
  const { customData: _drop, ...rest } = parsed.data;
  const row = await prisma.project.update({
    where: { id: existing.id },
    data: {
      ...rest,
      startDate: rest.startDate !== undefined
        ? rest.startDate
          ? new Date(rest.startDate)
          : null
        : undefined,
      endDate: rest.endDate !== undefined
        ? rest.endDate
          ? new Date(rest.endDate)
          : null
        : undefined,
      ...(parsed.data.customData !== undefined ? { customData: customData ?? undefined } : {}),
    },
  });
  res.json(row);
});

projectRouter.delete("/:id", p.delete, async (req, res) => {
  const existing = await prisma.project.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: { _count: { select: { tasks: true, timesheetLines: true } } },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing._count.tasks > 0 || existing._count.timesheetLines > 0)
    return res
      .status(400)
      .json({ error: "Cannot delete: project has tasks or timesheet lines" });
  await prisma.project.delete({ where: { id: existing.id } });
  res.status(204).send();
});
