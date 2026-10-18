import { Router } from "express";
import { z } from "zod";
import { prisma } from "@lumaara/db";
import { perms, requireAuth } from "@lumaara/service-auth";
import { eventBus } from "../lib/event-bus";

export const commentRouter = Router();

commentRouter.use(requireAuth);

const p = perms("Comment");

const createSchema = z.object({
  doctype: z.string().min(1),
  docId: z.string().min(1),
  body: z.string().min(1).max(10_000),
});

const updateSchema = z.object({
  body: z.string().min(1).max(10_000),
});

// List comments for a doc, oldest first (reads like a chat log).
commentRouter.get("/", p.read, async (req, res) => {
  const doctype = typeof req.query.doctype === "string" ? req.query.doctype : undefined;
  const docId = typeof req.query.docId === "string" ? req.query.docId : undefined;
  if (!doctype || !docId)
    return res.status(400).json({ error: "doctype + docId query params required" });
  const rows = await prisma.comment.findMany({
    where: { tenantId: req.auth!.tenantId, doctype, docId },
    orderBy: { createdAt: "asc" },
  });
  res.json(rows);
});

commentRouter.post("/", p.create, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const row = await prisma.comment.create({
    data: {
      tenantId: req.auth!.tenantId,
      doctype: parsed.data.doctype,
      docId: parsed.data.docId,
      body: parsed.data.body,
      authorUserId: req.auth!.userId,
    },
  });
  // Fan-out: anyone subscribed to this doctype's channel refreshes. In-process
  // bus — auth-service is both the comment writer and the SSE source, so no
  // HTTP round-trip needed. Cross-service writers use `publishRealtime` instead.
  eventBus.publish(req.auth!.tenantId, `activity:${parsed.data.doctype}`, {
    id: row.id,
    docId: parsed.data.docId,
    kind: "comment",
  });
  res.status(201).json(row);
});

commentRouter.put("/:id", p.write, async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.comment.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.authorUserId !== req.auth!.userId)
    return res.status(403).json({ error: "Only the author can edit this comment" });
  const row = await prisma.comment.update({
    where: { id: existing.id },
    data: { body: parsed.data.body },
  });
  res.json(row);
});

commentRouter.delete("/:id", p.delete, async (req, res) => {
  const existing = await prisma.comment.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const isAdmin =
    req.auth!.roles.includes("SystemManager") || req.auth!.role === "admin";
  if (existing.authorUserId !== req.auth!.userId && !isAdmin)
    return res.status(403).json({ error: "Only the author can delete this comment" });
  await prisma.comment.delete({ where: { id: existing.id } });
  res.status(204).send();
});
