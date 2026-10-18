import { Router } from "express";
import { prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// Gantt data endpoint — returns a flat feed the UI can render directly:
//   {
//     project,
//     dateRange: { min, max },        // suggested visible range
//     milestones: [{ id, name, dueDate, status }],
//     rows: [{
//       taskId, subject, level (0 = root, 1 = subtask),
//       parentTaskId, milestoneId,
//       startDate, endDate, progressPct, status, priority, assignedEmployeeId,
//     }],
//     dependencies: [{ id, fromTaskId, toTaskId, type }],
//     budget: { amount, spent, thresholdPct },
//   }
//
// Sorted so parent tasks appear before their children, matching Gantt's
// visual hierarchy.

export const ganttRouter = Router();
const p = perms("Project");

ganttRouter.get("/:projectId", p.read, async (req, res) => {
  const project = await prisma.project.findFirst({
    where: { id: req.params.projectId, tenantId: req.auth!.tenantId },
    include: {
      customer:       { select: { id: true, customerName: true } },
      projectManager: { select: { id: true, employeeName: true } },
    },
  });
  if (!project) return res.status(404).json({ error: "Not found" });

  const [milestones, tasks, dependencies] = await Promise.all([
    prisma.milestone.findMany({
      where: { projectId: project.id },
      orderBy: { order: "asc" },
    }),
    prisma.task.findMany({
      where: { projectId: project.id },
      orderBy: [{ parentTaskId: "asc" }, { sortOrder: "asc" }],
    }),
    prisma.taskDependency.findMany({
      where: {
        fromTask: { projectId: project.id, tenantId: req.auth!.tenantId },
      },
    }),
  ]);

  // Build hierarchy: parents first, then their subtasks nested underneath.
  const byParent = new Map<string | null, typeof tasks>();
  for (const t of tasks) {
    const key = t.parentTaskId ?? null;
    const arr = byParent.get(key) ?? [];
    arr.push(t);
    byParent.set(key, arr);
  }
  const rows: {
    taskId: string; subject: string; level: number;
    parentTaskId: string | null; milestoneId: string | null;
    startDate: Date | null; endDate: Date | null;
    progressPct: number; status: string; priority: string;
    assignedEmployeeId: string | null; expectedHours: number; actualHours: number;
  }[] = [];
  function walk(parentId: string | null, level: number): void {
    const children = byParent.get(parentId) ?? [];
    for (const t of children) {
      rows.push({
        taskId: t.id,
        subject: t.subject,
        level,
        parentTaskId: t.parentTaskId,
        milestoneId: t.milestoneId,
        startDate: t.startDate,
        endDate: t.endDate,
        progressPct: t.progressPct,
        status: t.status,
        priority: t.priority,
        assignedEmployeeId: t.assignedEmployeeId,
        expectedHours: Number(t.expectedHours),
        actualHours: Number(t.actualHours),
      });
      walk(t.id, level + 1);
    }
  }
  walk(null, 0);

  // Suggested visible range = union of project + task + milestone dates.
  const dates: number[] = [];
  if (project.startDate) dates.push(new Date(project.startDate).getTime());
  if (project.endDate)   dates.push(new Date(project.endDate).getTime());
  for (const t of tasks) {
    if (t.startDate) dates.push(new Date(t.startDate).getTime());
    if (t.endDate)   dates.push(new Date(t.endDate).getTime());
  }
  for (const m of milestones) {
    if (m.dueDate) dates.push(new Date(m.dueDate).getTime());
  }
  const min = dates.length ? new Date(Math.min(...dates)) : new Date();
  const max = dates.length ? new Date(Math.max(...dates)) : new Date(Date.now() + 30 * 24 * 3600 * 1000);

  res.json({
    project,
    dateRange: { min, max },
    milestones,
    rows,
    dependencies,
    budget: {
      amount: Number(project.budgetAmount),
      spent: Number(project.budgetSpent),
      thresholdPct: project.budgetThresholdPct,
      remaining: Number(project.budgetAmount) - Number(project.budgetSpent),
      utilPct:
        Number(project.budgetAmount) > 0
          ? Math.round((Number(project.budgetSpent) / Number(project.budgetAmount)) * 100)
          : 0,
    },
  });
});
