import { Router } from "express";
import { z } from "zod";
import { prisma, nextName } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// Project templates. `structureJson` is a self-contained recipe:
//   {
//     milestones: [{ ref: "m1", name: "Kickoff", dueOffsetDays: 7 }, …],
//     tasks:      [{ ref: "t1", subject: "Discovery", expectedHours: 8,
//                    milestoneRef?: "m1", dependsOnRefs?: ["t0"],
//                    startOffsetDays?, endOffsetDays? }, …],
//   }
// On /instantiate we create the Project + Milestones + Tasks + Dependencies
// in one transaction, translating `ref` handles to real cuids as we go.

export const projectTemplateRouter = Router();
const p = perms("Project");

const milestoneSpec = z.object({
  ref: z.string().min(1),
  name: z.string().min(1),
  dueOffsetDays: z.number().int().nonnegative().default(0),
});
const taskSpec = z.object({
  ref: z.string().min(1),
  subject: z.string().min(1),
  description: z.string().nullable().optional(),
  expectedHours: z.number().nonnegative().default(0),
  weight: z.number().int().positive().default(1),
  milestoneRef: z.string().nullable().optional(),
  dependsOnRefs: z.array(z.string()).optional(),
  startOffsetDays: z.number().int().nonnegative().nullable().optional(),
  endOffsetDays:   z.number().int().nonnegative().nullable().optional(),
});
const upsert = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  billingType: z.enum(["Fixed", "Hourly", "Non-billable"]).default("Non-billable"),
  defaultBudget: z.number().nonnegative().default(0),
  structureJson: z.object({
    milestones: z.array(milestoneSpec).default([]),
    tasks: z.array(taskSpec).default([]),
  }),
});

projectTemplateRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.projectTemplate.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: { updatedAt: "desc" },
  });
  res.json(rows);
});

projectTemplateRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.projectTemplate.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

projectTemplateRouter.post("/", p.create, async (req, res) => {
  const parsed = upsert.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const row = await prisma.projectTemplate.create({
      data: {
        tenantId: req.auth!.tenantId,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        billingType: parsed.data.billingType,
        defaultBudget: parsed.data.defaultBudget,
        structureJson: parsed.data.structureJson,
      },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint"))
      return res.status(409).json({ error: "Template name taken" });
    throw e;
  }
});

projectTemplateRouter.put("/:id", p.write, async (req, res) => {
  const parsed = upsert.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.projectTemplate.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const row = await prisma.projectTemplate.update({
    where: { id: existing.id },
    data: {
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      billingType: parsed.data.billingType,
      defaultBudget: parsed.data.defaultBudget,
      structureJson: parsed.data.structureJson,
    },
  });
  res.json(row);
});

projectTemplateRouter.delete("/:id", p.delete, async (req, res) => {
  await prisma.projectTemplate.deleteMany({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  res.status(204).end();
});

// Instantiate — creates a real Project + Milestones + Tasks + Dependencies
// from the template. Body carries the project-level overrides.
projectTemplateRouter.post("/:id/instantiate", p.write, async (req, res) => {
  const parsed = z
    .object({
      projectName: z.string().min(1),
      startDate: z.string().min(1), // ISO date — offsets computed from this
      customerId: z.string().nullable().optional(),
      projectManagerId: z.string().nullable().optional(),
      budgetAmount: z.number().nonnegative().optional(),
      notes: z.string().nullable().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tpl = await prisma.projectTemplate.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!tpl) return res.status(404).json({ error: "Template not found" });

  const structure = tpl.structureJson as unknown as {
    milestones?: { ref: string; name: string; dueOffsetDays: number }[];
    tasks?: {
      ref: string;
      subject: string;
      description?: string | null;
      expectedHours?: number;
      weight?: number;
      milestoneRef?: string | null;
      dependsOnRefs?: string[];
      startOffsetDays?: number | null;
      endOffsetDays?: number | null;
    }[];
  };

  const start = new Date(parsed.data.startDate);
  const offsetDate = (n: number | null | undefined) => {
    if (n === null || n === undefined) return null;
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + n);
    return d;
  };

  const created = await prisma.$transaction(async (tx) => {
    const projectName = await nextName(tx, req.auth!.tenantId, "PROJ-");
    const project = await tx.project.create({
      data: {
        tenantId: req.auth!.tenantId,
        name: projectName,
        projectName: parsed.data.projectName,
        customerId: parsed.data.customerId ?? null,
        projectManagerId: parsed.data.projectManagerId ?? null,
        startDate: start,
        status: "Open",
        billingType: tpl.billingType,
        budgetAmount: parsed.data.budgetAmount ?? tpl.defaultBudget,
        notes: parsed.data.notes ?? null,
        fromTemplateId: tpl.id,
      },
    });

    const milestoneMap = new Map<string, string>(); // ref → id
    for (let i = 0; i < (structure.milestones ?? []).length; i++) {
      const m = structure.milestones![i]!;
      const row = await tx.milestone.create({
        data: {
          tenantId: req.auth!.tenantId,
          projectId: project.id,
          name: m.name,
          dueDate: offsetDate(m.dueOffsetDays),
          order: i,
        },
      });
      milestoneMap.set(m.ref, row.id);
    }

    const taskMap = new Map<string, string>();
    for (let i = 0; i < (structure.tasks ?? []).length; i++) {
      const t = structure.tasks![i]!;
      const row = await tx.task.create({
        data: {
          tenantId: req.auth!.tenantId,
          projectId: project.id,
          subject: t.subject,
          description: t.description ?? null,
          expectedHours: t.expectedHours ?? 0,
          weight: t.weight ?? 1,
          milestoneId: t.milestoneRef ? milestoneMap.get(t.milestoneRef) ?? null : null,
          startDate: offsetDate(t.startOffsetDays ?? null),
          endDate: offsetDate(t.endOffsetDays ?? null),
          sortOrder: i,
        },
      });
      taskMap.set(t.ref, row.id);
    }

    // Second pass — resolve dependency refs (all tasks now exist).
    for (const t of structure.tasks ?? []) {
      const toId = taskMap.get(t.ref);
      if (!toId) continue;
      for (const ref of t.dependsOnRefs ?? []) {
        const fromId = taskMap.get(ref);
        if (!fromId || fromId === toId) continue;
        await tx.taskDependency.create({
          data: { fromTaskId: fromId, toTaskId: toId, type: "FS" },
        }).catch(() => {}); // ignore duplicates
      }
    }

    await tx.projectTemplate.update({
      where: { id: tpl.id },
      data: { usageCount: { increment: 1 } },
    });

    return project;
  });

  res.status(201).json({
    ok: true,
    projectId: created.id,
    projectName: created.projectName,
    milestonesCreated: (structure.milestones ?? []).length,
    tasksCreated: (structure.tasks ?? []).length,
  });
});
