import { Router } from "express";
import { z } from "zod";
import { prisma, nextName } from "@lumaara/db";
import { idempotency, perms } from "@lumaara/service-auth";

// E3: Employee Onboarding + Separation. Templates define reusable step lists;
// each Employee gets an instance ("checklist") whose activities can be ticked
// off one-by-one. When every activity is complete, the employee's status flips
// automatically (Active on Onboarding completion, Left on Separation).

export const employeeChecklistTemplateRouter = Router();
export const employeeChecklistRouter = Router();

const pt = perms("EmployeeChecklistTemplate");
const pc = perms("EmployeeChecklist");

const CHECKLIST_TYPES = ["Onboarding", "Separation"] as const;

// ---------------- Templates ----------------

const templateItemSchema = z.object({
  activity: z.string().min(1),
  description: z.string().optional().nullable(),
  role: z.string().optional().nullable(),
  sortOrder: z.coerce.number().int().nonnegative().default(0),
});

const templateSchema = z.object({
  name: z.string().min(1),
  type: z.enum(CHECKLIST_TYPES),
  description: z.string().optional().nullable(),
  items: z.array(templateItemSchema).default([]),
});

employeeChecklistTemplateRouter.get("/", pt.read, async (req, res) => {
  const rows = await prisma.employeeChecklistTemplate.findMany({
    where: { tenantId: req.auth!.tenantId },
    include: { _count: { select: { items: true } } },
    orderBy: [{ type: "asc" }, { name: "asc" }],
  });
  res.json(rows);
});

employeeChecklistTemplateRouter.get("/:id", pt.read, async (req, res) => {
  const row = await prisma.employeeChecklistTemplate.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: { items: { orderBy: { sortOrder: "asc" } } },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

employeeChecklistTemplateRouter.post("/", pt.create, async (req, res) => {
  const parsed = templateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const row = await prisma.employeeChecklistTemplate.create({
      data: {
        tenantId: req.auth!.tenantId,
        name: parsed.data.name,
        type: parsed.data.type,
        description: parsed.data.description ?? null,
        items: {
          create: parsed.data.items.map((i, idx) => ({
            activity: i.activity,
            description: i.description ?? null,
            role: i.role ?? null,
            sortOrder: i.sortOrder || idx,
          })),
        },
      },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint"))
      return res.status(409).json({ error: "Template name already exists" });
    throw e;
  }
});

employeeChecklistTemplateRouter.put("/:id", pt.write, async (req, res) => {
  const parsed = templateSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.employeeChecklistTemplate.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const body = parsed.data;

  const row = await prisma.$transaction(async (tx) => {
    if (body.items !== undefined) {
      await tx.employeeChecklistTemplateItem.deleteMany({ where: { templateId: existing.id } });
    }
    return tx.employeeChecklistTemplate.update({
      where: { id: existing.id },
      data: {
        name: body.name ?? existing.name,
        type: body.type ?? existing.type,
        description: body.description ?? existing.description,
        items: body.items
          ? {
              create: body.items.map((i, idx) => ({
                activity: i.activity,
                description: i.description ?? null,
                role: i.role ?? null,
                sortOrder: i.sortOrder || idx,
              })),
            }
          : undefined,
      },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });
  });
  res.json(row);
});

employeeChecklistTemplateRouter.delete("/:id", pt.delete, async (req, res) => {
  const existing = await prisma.employeeChecklistTemplate.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.employeeChecklistTemplate.delete({ where: { id: existing.id } });
  res.status(204).send();
});

// ---------------- Instances ----------------

const createChecklistSchema = z.object({
  type: z.enum(CHECKLIST_TYPES),
  employeeId: z.string().min(1),
  templateId: z.string().optional().nullable(),
  startDate: z.string().datetime().optional(),
  targetDate: z.string().datetime().optional().nullable(),
  notes: z.string().optional().nullable(),
  // If templateId is null, caller must supply explicit activities.
  activities: z.array(templateItemSchema).optional(),
});

employeeChecklistRouter.get("/", pc.read, async (req, res) => {
  const type = typeof req.query.type === "string" ? req.query.type : undefined;
  const employeeId = typeof req.query.employeeId === "string" ? req.query.employeeId : undefined;
  const rows = await prisma.employeeChecklist.findMany({
    where: {
      tenantId: req.auth!.tenantId,
      ...(type ? { type } : {}),
      ...(employeeId ? { employeeId } : {}),
    },
    include: {
      employee: { select: { employeeCode: true, employeeName: true } },
      _count: { select: { activities: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  res.json(rows);
});

employeeChecklistRouter.get("/:id", pc.read, async (req, res) => {
  const row = await prisma.employeeChecklist.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      employee: { select: { id: true, employeeCode: true, employeeName: true, status: true } },
      template: { select: { id: true, name: true } },
      activities: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

employeeChecklistRouter.post("/", pc.create, async (req, res) => {
  const parsed = createChecklistSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const body = parsed.data;

  const emp = await prisma.employee.findFirst({
    where: { id: body.employeeId, tenantId },
  });
  if (!emp) return res.status(400).json({ error: "Invalid employee" });

  let items: { activity: string; description: string | null; role: string | null; sortOrder: number }[] = [];
  if (body.templateId) {
    const tmpl = await prisma.employeeChecklistTemplate.findFirst({
      where: { id: body.templateId, tenantId },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });
    if (!tmpl) return res.status(400).json({ error: "Invalid template" });
    if (tmpl.type !== body.type)
      return res.status(400).json({ error: "Template type mismatch" });
    items = tmpl.items.map((i) => ({
      activity: i.activity,
      description: i.description,
      role: i.role,
      sortOrder: i.sortOrder,
    }));
  } else if (body.activities?.length) {
    items = body.activities.map((i, idx) => ({
      activity: i.activity,
      description: i.description ?? null,
      role: i.role ?? null,
      sortOrder: i.sortOrder || idx,
    }));
  } else {
    return res.status(400).json({ error: "Provide templateId or activities" });
  }

  const prefix = body.type === "Onboarding" ? "ONB-" : "SEP-";
  const name = await nextName(prisma, tenantId, prefix);
  const row = await prisma.employeeChecklist.create({
    data: {
      tenantId,
      name,
      type: body.type,
      employeeId: body.employeeId,
      templateId: body.templateId ?? null,
      startDate: body.startDate ? new Date(body.startDate) : new Date(),
      targetDate: body.targetDate ? new Date(body.targetDate) : null,
      notes: body.notes ?? null,
      activities: { create: items },
    },
    include: { activities: { orderBy: { sortOrder: "asc" } } },
  });
  res.status(201).json(row);
});

// Complete a single activity. Auto-completes the checklist when all done.
employeeChecklistRouter.post(
  "/:id/activities/:activityId/complete",
  pc.write,
  async (req, res) => {
    const tenantId = req.auth!.tenantId;
    const userId = req.auth!.userId;
    try {
      const result = await prisma.$transaction(async (tx) => {
        const checklist = await tx.employeeChecklist.findFirst({
          where: { id: req.params.id, tenantId },
          include: { activities: true },
        });
        if (!checklist) throw new Error("Not found");
        if (checklist.status !== "InProgress")
          throw new Error(`Cannot update ${checklist.status} checklist`);

        const activity = checklist.activities.find((a) => a.id === req.params.activityId);
        if (!activity) throw new Error("Activity not found");
        if (activity.isComplete)
          throw new Error("Activity already complete");

        await tx.employeeChecklistActivity.update({
          where: { id: activity.id },
          data: {
            isComplete: true,
            completedBy: userId,
            completedAt: new Date(),
          },
        });

        const remaining = checklist.activities.filter(
          (a) => a.id !== activity.id && !a.isComplete,
        );
        if (remaining.length === 0) {
          // Auto-complete: update checklist + flip employee status.
          const newEmpStatus = checklist.type === "Onboarding" ? "Active" : "Left";
          await tx.employee.update({
            where: { id: checklist.employeeId },
            data: { status: newEmpStatus },
          });
          await tx.employeeChecklist.update({
            where: { id: checklist.id },
            data: { status: "Completed" },
          });
        }

        return tx.employeeChecklist.findFirst({
          where: { id: checklist.id },
          include: {
            activities: { orderBy: { sortOrder: "asc" } },
            employee: { select: { id: true, status: true } },
          },
        });
      });
      res.json(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed";
      res.status(msg === "Not found" ? 404 : 400).json({ error: msg });
    }
  },
);

// Uncheck an activity.
employeeChecklistRouter.post(
  "/:id/activities/:activityId/reopen",
  pc.write,
  async (req, res) => {
    const tenantId = req.auth!.tenantId;
    const checklist = await prisma.employeeChecklist.findFirst({
      where: { id: req.params.id, tenantId },
    });
    if (!checklist) return res.status(404).json({ error: "Not found" });
    if (checklist.status === "Cancelled")
      return res.status(400).json({ error: "Checklist is cancelled" });
    await prisma.employeeChecklistActivity.update({
      where: { id: req.params.activityId },
      data: { isComplete: false, completedBy: null, completedAt: null },
    });
    if (checklist.status === "Completed") {
      await prisma.employeeChecklist.update({
        where: { id: checklist.id },
        data: { status: "InProgress" },
      });
    }
    res.json({ ok: true });
  },
);

employeeChecklistRouter.post("/:id/cancel", pc.cancel, idempotency("POST /employee-checklists/:id/cancel"), async (req, res) => {
  const existing = await prisma.employeeChecklist.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.status === "Cancelled")
    return res.status(400).json({ error: "Already cancelled" });
  const row = await prisma.employeeChecklist.update({
    where: { id: existing.id },
    data: { status: "Cancelled" },
  });
  res.json(row);
});
