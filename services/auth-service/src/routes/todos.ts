import { Router } from "express";
import { z } from "zod";
import { prisma } from "@lumaara/db";
import { perms, requireAuth } from "@lumaara/service-auth";

export const todoRouter = Router();

todoRouter.use(requireAuth);

const p = perms("Todo");

const PRIORITY = ["Low", "Medium", "High"] as const;

const createSchema = z.object({
  description: z.string().min(1).max(2000),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  priority: z.enum(PRIORITY).optional(),
  doctype: z.string().min(1).optional(),
  docId: z.string().min(1).optional(),
  // Managers can create todos assigned to other users; falls back to self.
  ownerUserId: z.string().min(1).optional(),
});

const updateSchema = z.object({
  description: z.string().min(1).max(2000).optional(),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  priority: z.enum(PRIORITY).optional(),
  isDone: z.boolean().optional(),
});

// List todos owned by the current user unless SystemManager passes ?all=1.
todoRouter.get("/", p.read, async (req, res) => {
  const isAdmin =
    req.auth!.roles.includes("SystemManager") || req.auth!.role === "admin";
  const includeAll = isAdmin && req.query.all === "1";
  const status = req.query.status; // "open" | "done" | undefined
  const rows = await prisma.todo.findMany({
    where: {
      tenantId: req.auth!.tenantId,
      ...(includeAll ? {} : { ownerUserId: req.auth!.userId }),
      ...(status === "open" ? { isDone: false } : {}),
      ...(status === "done" ? { isDone: true } : {}),
    },
    orderBy: [{ isDone: "asc" }, { dueDate: "asc" }, { createdAt: "desc" }],
    take: 500,
  });
  res.json(rows);
});

todoRouter.post("/", p.create, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const isAdmin =
    req.auth!.roles.includes("SystemManager") || req.auth!.role === "admin";
  // Only admins may assign a todo to somebody else.
  const owner = parsed.data.ownerUserId && isAdmin
    ? parsed.data.ownerUserId
    : req.auth!.userId;
  const row = await prisma.todo.create({
    data: {
      tenantId: req.auth!.tenantId,
      ownerUserId: owner,
      description: parsed.data.description,
      dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null,
      priority: parsed.data.priority ?? "Medium",
      doctype: parsed.data.doctype ?? null,
      docId: parsed.data.docId ?? null,
    },
  });
  res.status(201).json(row);
});

todoRouter.put("/:id", p.write, async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.todo.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const isAdmin =
    req.auth!.roles.includes("SystemManager") || req.auth!.role === "admin";
  if (existing.ownerUserId !== req.auth!.userId && !isAdmin)
    return res.status(403).json({ error: "Only the owner can update this todo" });

  const wasOpen = !existing.isDone;
  const nowDone = parsed.data.isDone === true;
  const nowReopened = parsed.data.isDone === false;

  const row = await prisma.todo.update({
    where: { id: existing.id },
    data: {
      ...(parsed.data.description !== undefined && { description: parsed.data.description }),
      ...(parsed.data.dueDate !== undefined && {
        dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null,
      }),
      ...(parsed.data.priority !== undefined && { priority: parsed.data.priority }),
      ...(parsed.data.isDone !== undefined && { isDone: parsed.data.isDone }),
      ...(wasOpen && nowDone && { completedAt: new Date() }),
      ...(nowReopened && { completedAt: null }),
    },
  });
  res.json(row);
});

todoRouter.delete("/:id", p.delete, async (req, res) => {
  const existing = await prisma.todo.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const isAdmin =
    req.auth!.roles.includes("SystemManager") || req.auth!.role === "admin";
  if (existing.ownerUserId !== req.auth!.userId && !isAdmin)
    return res.status(403).json({ error: "Only the owner can delete this todo" });
  await prisma.todo.delete({ where: { id: existing.id } });
  res.status(204).send();
});
