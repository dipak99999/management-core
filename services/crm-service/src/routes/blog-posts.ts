import { Router } from "express";
import { z } from "zod";
import { prisma, resolvePublishedAt, isPubliclyReadable } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// Blog Posts — chronological articles published at /portal/blog/:slug.
// Same shape as WebPage but with author + excerpt + category + featured
// image, and a chronological public index (/public/blog-posts, latest first).

export const blogPostRouter = Router();
export const blogPostPublicRouter = Router();
const p = perms("BlogPost");

const upsertSchema = z.object({
  name: z.string().min(1).max(128),
  publicSlug: z
    .string()
    .min(1)
    .max(96)
    .regex(/^[a-z0-9-]+$/, "slug must be lowercase alphanumeric + dashes"),
  title: z.string().min(1).max(200),
  excerpt: z.string().max(400).nullable().optional(),
  bodyHtml: z.string().min(1),
  authorName: z.string().max(128).nullable().optional(),
  category: z.string().max(96).nullable().optional(),
  featuredImage: z.string().url().nullable().optional(),
  isPublished: z.boolean().optional(),
});

blogPostRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.blogPost.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: [{ isPublished: "desc" }, { publishedAt: "desc" }, { updatedAt: "desc" }],
  });
  res.json(rows);
});

blogPostRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.blogPost.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

blogPostRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const publishedAt = resolvePublishedAt(null, parsed.data.isPublished === true);
    const row = await prisma.blogPost.create({
      data: {
        tenantId: req.auth!.tenantId,
        name: parsed.data.name,
        publicSlug: parsed.data.publicSlug,
        title: parsed.data.title,
        excerpt: parsed.data.excerpt ?? null,
        bodyHtml: parsed.data.bodyHtml,
        authorName: parsed.data.authorName ?? null,
        category: parsed.data.category ?? null,
        featuredImage: parsed.data.featuredImage ?? null,
        isPublished: parsed.data.isPublished ?? false,
        publishedAt,
      },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint"))
      return res.status(409).json({ error: "Name or slug already in use" });
    throw e;
  }
});

blogPostRouter.put("/:id", p.write, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.blogPost.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });

  const nextPublished = parsed.data.isPublished ?? existing.isPublished;
  const publishedAt = resolvePublishedAt(existing.publishedAt, nextPublished);

  try {
    const row = await prisma.blogPost.update({
      where: { id: existing.id },
      data: {
        name: parsed.data.name,
        publicSlug: parsed.data.publicSlug,
        title: parsed.data.title,
        excerpt: parsed.data.excerpt ?? null,
        bodyHtml: parsed.data.bodyHtml,
        authorName: parsed.data.authorName ?? null,
        category: parsed.data.category ?? null,
        featuredImage: parsed.data.featuredImage ?? null,
        isPublished: nextPublished,
        publishedAt,
      },
    });
    res.json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint"))
      return res.status(409).json({ error: "Name or slug already in use" });
    throw e;
  }
});

blogPostRouter.delete("/:id", p.delete, async (req, res) => {
  await prisma.blogPost.deleteMany({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  res.status(204).end();
});

// ── Public (no auth) ────────────────────────────────────────────────────

// GET /public/blog-posts → published index, latest first. Excludes bodyHtml
// to keep the payload small; the card only needs excerpt + featured image.
// Optional `?category=` filter for a themed archive page.
blogPostPublicRouter.get("/", async (req, res) => {
  const category =
    typeof req.query.category === "string" ? req.query.category : null;
  const rows = await prisma.blogPost.findMany({
    where: { isPublished: true, ...(category ? { category } : {}) },
    select: {
      id: true,
      publicSlug: true,
      title: true,
      excerpt: true,
      authorName: true,
      category: true,
      featuredImage: true,
      publishedAt: true,
    },
    orderBy: { publishedAt: "desc" },
    take: 50,
  });
  res.json(rows);
});

blogPostPublicRouter.get("/:slug", async (req, res) => {
  const post = await prisma.blogPost.findUnique({
    where: { publicSlug: req.params.slug },
  });
  if (!isPubliclyReadable(post))
    return res.status(404).json({ error: "Not found" });
  res.json({
    slug: post.publicSlug,
    title: post.title,
    excerpt: post.excerpt,
    bodyHtml: post.bodyHtml,
    authorName: post.authorName,
    category: post.category,
    featuredImage: post.featuredImage,
    publishedAt: post.publishedAt,
  });
});
