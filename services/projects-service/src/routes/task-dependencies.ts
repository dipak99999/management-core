import { Router } from "express";
import { z } from "zod";
import { prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// Task dependencies — directed edges fromTask → toTask. FS (Finish-to-Start)
// is the default; the schema keeps room for SS/FF/SF for future Gantt work.
//
// Cycle prevention: before creating an edge A→B, we walk the graph starting
// at B and refuse if we can reach A. Simple DFS bounded by task count so it
// stays cheap even on large projects.

export const taskDependencyRouter = Router();
const p = perms("Task");

const createSchema = z.object({
  fromTaskId: z.string().min(1),
  toTaskId: z.string().min(1),
  type: z.enum(["FS", "SS", "FF", "SF"]).default("FS"),
});

async function wouldCreateCycle(
  fromTaskId: string,
  toTaskId: string,
  tenantId: string,
): Promise<boolean> {
  if (fromTaskId === toTaskId) return true;
  // Walk downstream from `toTaskId`: if we ever reach `fromTaskId`, adding
  // `fromTask → toTask` closes a cycle.
  const seen = new Set<string>();
  const stack = [toTaskId];
  let steps = 0;
  while (stack.length > 0 && steps++ < 1000) {
    const cur = stack.pop()!;
    if (cur === fromTaskId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    const outs = await prisma.taskDependency.findMany({
      where: { fromTaskId: cur, fromTask: { tenantId } },
      select: { toTaskId: true },
    });
    for (const o of outs) stack.push(o.toTaskId);
  }
  return false;
}

// List — either by task or by project.
taskDependencyRouter.get("/", p.read, async (req, res) => {
  const { taskId, projectId } = req.query as Record<string, string | undefined>;
  const rows = await prisma.taskDependency.findMany({
    where: {
      fromTask: { tenantId: req.auth!.tenantId },
      ...(taskId ? {
        OR: [{ fromTaskId: taskId }, { toTaskId: taskId }],
      } : {}),
      ...(projectId ? {
        fromTask: { projectId, tenantId: req.auth!.tenantId },
      } : {}),
    },
    include: {
      fromTask: { select: { id: true, subject: true, projectId: true } },
      toTask:   { select: { id: true, subject: true, projectId: true } },
    },
  });
  res.json(rows);
});

taskDependencyRouter.post("/", p.write, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { fromTaskId, toTaskId, type } = parsed.data;

  // Both tasks must exist in the caller's tenant + same project.
  const [fromTask, toTask] = await Promise.all([
    prisma.task.findFirst({ where: { id: fromTaskId, tenantId: req.auth!.tenantId } }),
    prisma.task.findFirst({ where: { id: toTaskId, tenantId: req.auth!.tenantId } }),
  ]);
  if (!fromTask || !toTask) return res.status(404).json({ error: "Task not found" });
  if (fromTask.projectId !== toTask.projectId)
    return res.status(400).json({ error: "Tasks must be in the same project" });

  if (await wouldCreateCycle(fromTaskId, toTaskId, req.auth!.tenantId))
    return res.status(400).json({ error: "That would create a cycle" });

  try {
    const row = await prisma.taskDependency.create({
      data: { fromTaskId, toTaskId, type },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint"))
      return res.status(409).json({ error: "Dependency already exists" });
    throw e;
  }
});

taskDependencyRouter.delete("/:id", p.write, async (req, res) => {
  const dep = await prisma.taskDependency.findUnique({
    where: { id: req.params.id },
    include: { fromTask: { select: { tenantId: true } } },
  });
  if (!dep || dep.fromTask.tenantId !== req.auth!.tenantId)
    return res.status(404).json({ error: "Not found" });
  await prisma.taskDependency.delete({ where: { id: dep.id } });
  res.status(204).end();
});
