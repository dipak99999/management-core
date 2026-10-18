import { Router } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@lumaara/db";
import { perms, requireAuth } from "@lumaara/service-auth";

// Zoho-Notebook-style personal notes. A Notebook is a container; each Note
// holds a JSON body of blocks (text / checklist / divider). Notes can be
// pinned, archived, or trashed. Tags are a flat string array per note —
// keeps the model simple, and search is a fast case-insensitive contains.

export const notebookRouter = Router();
notebookRouter.use(requireAuth);

const nbPerms   = perms("Notebook");
const notePerms = perms("Note");

/* ─────────────────────────── NOTEBOOKS ────────────────────────────────── */

const notebookColors = ["violet", "blue", "green", "amber", "rose", "slate"] as const;

const notebookUpsert = z.object({
  name: z.string().min(1).max(120),
  color: z.enum(notebookColors).optional(),
  icon: z.string().max(10).nullable().optional(),
  isShared: z.boolean().optional(),
});

notebookRouter.get("/notebooks", nbPerms.read, async (req, res) => {
  const showArchived = req.query.archived === "true";
  const rows = await prisma.notebook.findMany({
    where: {
      tenantId: req.auth!.tenantId,
      // Own or shared notebooks are always visible.
      OR: [{ ownerUserId: req.auth!.userId }, { isShared: true }],
      archivedAt: showArchived ? { not: null } : null,
    },
    include: {
      _count: {
        select: { notes: { where: { deletedAt: null, archivedAt: null } } },
      },
    },
    orderBy: [{ name: "asc" }],
  });
  res.json(rows);
});

notebookRouter.post("/notebooks", nbPerms.create, async (req, res) => {
  const parsed = notebookUpsert.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const row = await prisma.notebook.create({
    data: {
      tenantId: req.auth!.tenantId,
      ownerUserId: req.auth!.userId,
      name: parsed.data.name,
      color: parsed.data.color ?? "violet",
      icon: parsed.data.icon ?? null,
      isShared: parsed.data.isShared ?? false,
    },
  });
  res.status(201).json(row);
});

notebookRouter.put("/notebooks/:id", nbPerms.write, async (req, res) => {
  const parsed = notebookUpsert.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.notebook.findFirst({
    where: {
      id: req.params.id,
      tenantId: req.auth!.tenantId,
      ownerUserId: req.auth!.userId,
    },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const row = await prisma.notebook.update({
    where: { id: existing.id },
    data: parsed.data,
  });
  res.json(row);
});

notebookRouter.post("/notebooks/:id/archive", nbPerms.write, async (req, res) => {
  const existing = await prisma.notebook.findFirst({
    where: {
      id: req.params.id,
      tenantId: req.auth!.tenantId,
      ownerUserId: req.auth!.userId,
    },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const row = await prisma.notebook.update({
    where: { id: existing.id },
    data: { archivedAt: existing.archivedAt ? null : new Date() },
  });
  res.json(row);
});

notebookRouter.delete("/notebooks/:id", nbPerms.delete, async (req, res) => {
  const existing = await prisma.notebook.findFirst({
    where: {
      id: req.params.id,
      tenantId: req.auth!.tenantId,
      ownerUserId: req.auth!.userId,
    },
    include: { _count: { select: { notes: true } } },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing._count.notes > 0)
    return res.status(400).json({ error: "Move or delete notes first" });
  await prisma.notebook.delete({ where: { id: existing.id } });
  res.status(204).send();
});

/* ─────────────────────────────── NOTES ────────────────────────────────── */

const blockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("checklist"), text: z.string(), done: z.boolean() }),
  z.object({ type: z.literal("divider") }),
]);

const noteUpsert = z.object({
  notebookId: z.string().min(1),
  title: z.string().min(0).max(200).default(""),
  body: z.array(blockSchema).default([]),
  type: z.enum(["Text", "Checklist", "Mixed"]).optional(),
  tags: z.array(z.string().min(1).max(40)).optional(),
  color: z.enum(["default", "yellow", "pink", "mint", "sky", "lilac"]).optional(),
  pinned: z.boolean().optional(),
  reminderAt: z.string().datetime().nullable().optional(),
});

function derivedType(body: z.infer<typeof blockSchema>[]): "Text" | "Checklist" | "Mixed" {
  let hasText = false;
  let hasCheck = false;
  for (const b of body) {
    if (b.type === "text") hasText = true;
    else if (b.type === "checklist") hasCheck = true;
  }
  if (hasText && hasCheck) return "Mixed";
  if (hasCheck) return "Checklist";
  return "Text";
}

notebookRouter.get("/notes", notePerms.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const notebookId = typeof req.query.notebookId === "string" ? req.query.notebookId : undefined;
  const search     = typeof req.query.search     === "string" ? req.query.search     : undefined;
  const tag        = typeof req.query.tag        === "string" ? req.query.tag        : undefined;
  const view       = typeof req.query.view       === "string" ? req.query.view       : "active";
  //   view: active (default) | archived | trash | pinned | reminders | all

  const where: Prisma.NoteWhereInput = {
    tenantId,
    // Access: your own notes, plus notes in shared notebooks.
    OR: [
      { ownerUserId: req.auth!.userId },
      { notebook: { isShared: true } },
    ],
    ...(notebookId ? { notebookId } : {}),
    ...(tag ? { tags: { has: tag } } : {}),
  };
  if (view === "archived") {
    where.archivedAt = { not: null };
    where.deletedAt = null;
  } else if (view === "trash") {
    where.deletedAt = { not: null };
  } else if (view === "pinned") {
    where.pinned = true;
    where.deletedAt = null;
    where.archivedAt = null;
  } else if (view === "reminders") {
    where.reminderAt = { not: null };
    where.deletedAt = null;
  } else if (view === "all") {
    // no lifecycle filter
  } else {
    where.deletedAt = null;
    where.archivedAt = null;
  }
  if (search) {
    where.title = { contains: search, mode: "insensitive" };
  }

  const rows = await prisma.note.findMany({
    where,
    include: { notebook: { select: { id: true, name: true, color: true } } },
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    take: 500,
  });
  res.json(rows);
});

notebookRouter.get("/notes/:id", notePerms.read, async (req, res) => {
  const row = await prisma.note.findFirst({
    where: {
      id: req.params.id,
      tenantId: req.auth!.tenantId,
      OR: [
        { ownerUserId: req.auth!.userId },
        { notebook: { isShared: true } },
      ],
    },
    include: { notebook: { select: { id: true, name: true, color: true } } },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

notebookRouter.post("/notes", notePerms.create, async (req, res) => {
  const parsed = noteUpsert.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const nb = await prisma.notebook.findFirst({
    where: {
      id: parsed.data.notebookId,
      tenantId,
      OR: [{ ownerUserId: req.auth!.userId }, { isShared: true }],
    },
  });
  if (!nb) return res.status(400).json({ error: "Invalid notebook" });
  const type = parsed.data.type ?? derivedType(parsed.data.body);
  const row = await prisma.note.create({
    data: {
      tenantId,
      notebookId: parsed.data.notebookId,
      ownerUserId: req.auth!.userId,
      title: parsed.data.title,
      body: parsed.data.body as unknown as Prisma.InputJsonValue,
      type,
      tags: parsed.data.tags ?? [],
      color: parsed.data.color ?? "default",
      pinned: parsed.data.pinned ?? false,
      reminderAt: parsed.data.reminderAt ? new Date(parsed.data.reminderAt) : null,
    },
  });
  res.status(201).json(row);
});

notebookRouter.put("/notes/:id", notePerms.write, async (req, res) => {
  const parsed = noteUpsert.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.note.findFirst({
    where: {
      id: req.params.id,
      tenantId: req.auth!.tenantId,
      ownerUserId: req.auth!.userId,
    },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (parsed.data.notebookId && parsed.data.notebookId !== existing.notebookId) {
    const nb = await prisma.notebook.findFirst({
      where: {
        id: parsed.data.notebookId,
        tenantId: req.auth!.tenantId,
        OR: [{ ownerUserId: req.auth!.userId }, { isShared: true }],
      },
    });
    if (!nb) return res.status(400).json({ error: "Invalid notebook" });
  }
  const data: Prisma.NoteUpdateInput = {};
  if (parsed.data.notebookId !== undefined)
    data.notebook = { connect: { id: parsed.data.notebookId } };
  if (parsed.data.title !== undefined) data.title = parsed.data.title;
  if (parsed.data.body !== undefined) {
    data.body = parsed.data.body as unknown as Prisma.InputJsonValue;
    if (parsed.data.type === undefined) data.type = derivedType(parsed.data.body);
  }
  if (parsed.data.type !== undefined) data.type = parsed.data.type;
  if (parsed.data.tags !== undefined) data.tags = parsed.data.tags;
  if (parsed.data.color !== undefined) data.color = parsed.data.color;
  if (parsed.data.pinned !== undefined) data.pinned = parsed.data.pinned;
  if (parsed.data.reminderAt !== undefined)
    data.reminderAt = parsed.data.reminderAt ? new Date(parsed.data.reminderAt) : null;
  const row = await prisma.note.update({ where: { id: existing.id }, data });
  res.json(row);
});

// Toggle a single checklist block's `done`. Zoho lets you tick items without
// opening a full editor — nice for quick capture.
notebookRouter.post("/notes/:id/toggle-item", notePerms.write, async (req, res) => {
  const parsed = z.object({ index: z.coerce.number().int().min(0) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.note.findFirst({
    where: {
      id: req.params.id,
      tenantId: req.auth!.tenantId,
      OR: [
        { ownerUserId: req.auth!.userId },
        { notebook: { isShared: true } },
      ],
    },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const body = (existing.body as unknown as { type: string; done?: boolean; text?: string }[])
    .slice();
  const block = body[parsed.data.index];
  if (!block || block.type !== "checklist")
    return res.status(400).json({ error: "Not a checklist block" });
  block.done = !block.done;
  const row = await prisma.note.update({
    where: { id: existing.id },
    data: { body: body as unknown as Prisma.InputJsonValue },
  });
  res.json(row);
});

notebookRouter.post("/notes/:id/archive", notePerms.write, async (req, res) => {
  const existing = await prisma.note.findFirst({
    where: {
      id: req.params.id,
      tenantId: req.auth!.tenantId,
      ownerUserId: req.auth!.userId,
    },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const row = await prisma.note.update({
    where: { id: existing.id },
    data: {
      archivedAt: existing.archivedAt ? null : new Date(),
      pinned: false,
    },
  });
  res.json(row);
});

notebookRouter.delete("/notes/:id", notePerms.delete, async (req, res) => {
  const existing = await prisma.note.findFirst({
    where: {
      id: req.params.id,
      tenantId: req.auth!.tenantId,
      ownerUserId: req.auth!.userId,
    },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.note.update({
    where: { id: existing.id },
    data: { deletedAt: existing.deletedAt ? null : new Date(), pinned: false },
  });
  res.status(204).send();
});

notebookRouter.post("/notes/:id/restore", notePerms.write, async (req, res) => {
  const existing = await prisma.note.findFirst({
    where: {
      id: req.params.id,
      tenantId: req.auth!.tenantId,
      ownerUserId: req.auth!.userId,
    },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const row = await prisma.note.update({
    where: { id: existing.id },
    data: { deletedAt: null, archivedAt: null },
  });
  res.json(row);
});

notebookRouter.post("/notes/:id/purge", notePerms.delete, async (req, res) => {
  const existing = await prisma.note.findFirst({
    where: {
      id: req.params.id,
      tenantId: req.auth!.tenantId,
      ownerUserId: req.auth!.userId,
    },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (!existing.deletedAt)
    return res.status(400).json({ error: "Trash a note before purging" });
  await prisma.note.delete({ where: { id: existing.id } });
  res.status(204).send();
});

/* ─────────────────────────────── TAGS ─────────────────────────────────── */
//
// Distinct tags used by the current user across all their notes. Used to
// populate the tag chip cloud in the sidebar.

notebookRouter.get("/tags", notePerms.read, async (req, res) => {
  const rows = await prisma.note.findMany({
    where: {
      tenantId: req.auth!.tenantId,
      OR: [
        { ownerUserId: req.auth!.userId },
        { notebook: { isShared: true } },
      ],
      deletedAt: null,
      tags: { isEmpty: false },
    },
    select: { tags: true },
    take: 2000,
  });
  const counts = new Map<string, number>();
  for (const r of rows) {
    for (const t of r.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const list = [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);
  res.json(list);
});
