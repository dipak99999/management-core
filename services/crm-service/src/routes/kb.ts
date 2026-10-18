import { Router } from "express";
import { z } from "zod";
import { prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// Module 52 — Knowledge Base routes.
//
// Categories: tree with slug + parent. Articles: markdown body,
// publish/draft states, view counter, tags. Search endpoint powers
// the ticket-form "matching articles" suggestion.

export const kbCategoryRouter = Router();
export const kbArticleRouter = Router();
const p = perms("DeskTicket"); // reuse the helpdesk perm surface

const categorySchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(200),
  description: z.string().max(1000).optional().nullable(),
  parentId: z.string().optional().nullable(),
  sortOrder: z.coerce.number().int().default(100),
});

const articleSchema = z.object({
  categoryId: z.string().optional().nullable(),
  title: z.string().min(1).max(300),
  slug: z.string().min(1).max(300),
  bodyMarkdown: z.string().min(1),
  tags: z.array(z.string()).default([]),
});

// ---------- Categories ----------

kbCategoryRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.kBCategory.findMany({
    where: { tenantId: req.auth!.tenantId },
    include: { _count: { select: { articles: true } } },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  res.json(rows);
});

kbCategoryRouter.post("/", p.create, async (req, res) => {
  const parsed = categorySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;
  const tenantId = req.auth!.tenantId;
  try {
    const row = await prisma.kBCategory.create({
      data: {
        tenantId,
        name: b.name,
        slug: b.slug,
        description: b.description ?? null,
        parentId: b.parentId ?? null,
        sortOrder: b.sortOrder,
      },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint")) {
      return res.status(409).json({ error: "Slug already exists" });
    }
    throw e;
  }
});

kbCategoryRouter.put("/:id", p.write, async (req, res) => {
  const parsed = categorySchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;
  const tenantId = req.auth!.tenantId;
  const existing = await prisma.kBCategory.findFirst({ where: { id: req.params.id, tenantId } });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const row = await prisma.kBCategory.update({
    where: { id: existing.id },
    data: {
      ...(b.name !== undefined ? { name: b.name } : {}),
      ...(b.slug !== undefined ? { slug: b.slug } : {}),
      ...(b.description !== undefined ? { description: b.description } : {}),
      ...(b.parentId !== undefined ? { parentId: b.parentId } : {}),
      ...(b.sortOrder !== undefined ? { sortOrder: b.sortOrder } : {}),
    },
  });
  res.json(row);
});

kbCategoryRouter.delete("/:id", p.create, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const existing = await prisma.kBCategory.findFirst({ where: { id: req.params.id, tenantId } });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const usedCount = await prisma.kBArticle.count({ where: { categoryId: existing.id } });
  if (usedCount > 0) {
    return res.status(400).json({
      error: `Cannot delete — ${usedCount} article(s) still reference this category. Move them first.`,
    });
  }
  await prisma.kBCategory.delete({ where: { id: existing.id } });
  res.json({ ok: true });
});

// ---------- Articles ----------
// Search endpoint MUST come before /:id so Express matches correctly.

kbArticleRouter.get("/search", p.read, async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const tenantId = req.auth!.tenantId;
  if (!q) return res.json([]);
  // Simple ILIKE across title/body/tags. Good enough for MVP; a
  // future FTS index would improve ranking on large tenants.
  const rows = await prisma.kBArticle.findMany({
    where: {
      tenantId,
      status: "Published",
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { bodyMarkdown: { contains: q, mode: "insensitive" } },
        { tags: { has: q.toLowerCase() } },
      ],
    },
    select: { id: true, title: true, slug: true, viewCount: true, tags: true },
    orderBy: { viewCount: "desc" },
    take: 20,
  });
  res.json(rows);
});

kbArticleRouter.get("/", p.read, async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const rows = await prisma.kBArticle.findMany({
    where: {
      tenantId: req.auth!.tenantId,
      ...(status ? { status } : {}),
    },
    include: {
      category: { select: { name: true, slug: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
  res.json(rows);
});

kbArticleRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.kBArticle.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: { category: true },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  // Bump view count best-effort — not critical if it fails.
  void prisma.kBArticle.update({ where: { id: row.id }, data: { viewCount: { increment: 1 } } }).catch(() => {});
  res.json(row);
});

kbArticleRouter.post("/", p.create, async (req, res) => {
  const parsed = articleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;
  const tenantId = req.auth!.tenantId;
  try {
    const row = await prisma.kBArticle.create({
      data: {
        tenantId,
        categoryId: b.categoryId ?? null,
        title: b.title,
        slug: b.slug,
        bodyMarkdown: b.bodyMarkdown,
        tags: b.tags.map((t) => t.toLowerCase()),
        status: "Draft",
      },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint")) {
      return res.status(409).json({ error: "Slug already exists" });
    }
    throw e;
  }
});

kbArticleRouter.put("/:id", p.write, async (req, res) => {
  const parsed = articleSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;
  const tenantId = req.auth!.tenantId;
  const existing = await prisma.kBArticle.findFirst({ where: { id: req.params.id, tenantId } });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const row = await prisma.kBArticle.update({
    where: { id: existing.id },
    data: {
      ...(b.categoryId !== undefined ? { categoryId: b.categoryId } : {}),
      ...(b.title !== undefined ? { title: b.title } : {}),
      ...(b.slug !== undefined ? { slug: b.slug } : {}),
      ...(b.bodyMarkdown !== undefined ? { bodyMarkdown: b.bodyMarkdown } : {}),
      ...(b.tags !== undefined ? { tags: b.tags.map((t) => t.toLowerCase()) } : {}),
    },
  });
  res.json(row);
});

kbArticleRouter.post("/:id/publish", p.submit, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const existing = await prisma.kBArticle.findFirst({ where: { id: req.params.id, tenantId } });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const row = await prisma.kBArticle.update({
    where: { id: existing.id },
    data: { status: "Published", publishedAt: new Date() },
  });
  res.json(row);
});

kbArticleRouter.post("/:id/archive", p.write, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const existing = await prisma.kBArticle.findFirst({ where: { id: req.params.id, tenantId } });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const row = await prisma.kBArticle.update({
    where: { id: existing.id },
    data: { status: "Archived" },
  });
  res.json(row);
});
