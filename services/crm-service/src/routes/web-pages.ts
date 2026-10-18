import { Router } from "express";
import { z } from "zod";
import { prisma, resolvePublishedAt, isPubliclyReadable } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// Web Pages — evergreen public marketing pages (about, pricing, contact).
// Body is raw HTML rendered verbatim; the operator's editor is a textarea
// (matching LandingPage's approach). Public reads live on a separate router
// so they can be mounted without requireAuth.

export const webPageRouter = Router();
export const webPagePublicRouter = Router();
const p = perms("WebPage");

const upsertSchema = z.object({
  name: z.string().min(1).max(128),
  publicSlug: z
    .string()
    .min(1)
    .max(96)
    .regex(/^[a-z0-9-]+$/, "slug must be lowercase alphanumeric + dashes"),
  title: z.string().min(1).max(200),
  description: z.string().nullable().optional(),
  bodyHtml: z.string().min(1),
  headHtml: z.string().nullable().optional(),
  isPublished: z.boolean().optional(),
});

webPageRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.webPage.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: { updatedAt: "desc" },
  });
  res.json(rows);
});

webPageRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.webPage.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

webPageRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    // Pure helper — covered by cms.test.ts. On create the "existing" is null,
    // so this returns `now` iff isPublished=true, else null.
    const publishedAt = resolvePublishedAt(null, parsed.data.isPublished === true);
    const row = await prisma.webPage.create({
      data: {
        tenantId: req.auth!.tenantId,
        name: parsed.data.name,
        publicSlug: parsed.data.publicSlug,
        title: parsed.data.title,
        description: parsed.data.description ?? null,
        bodyHtml: parsed.data.bodyHtml,
        headHtml: parsed.data.headHtml ?? null,
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

webPageRouter.put("/:id", p.write, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.webPage.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });

  const nextPublished = parsed.data.isPublished ?? existing.isPublished;
  // Pure helper — preserves publishedAt across unpublish→republish so the
  // "first published" anchor stays stable for RSS/sitemap ordering.
  const publishedAt = resolvePublishedAt(existing.publishedAt, nextPublished);

  try {
    const row = await prisma.webPage.update({
      where: { id: existing.id },
      data: {
        name: parsed.data.name,
        publicSlug: parsed.data.publicSlug,
        title: parsed.data.title,
        description: parsed.data.description ?? null,
        bodyHtml: parsed.data.bodyHtml,
        headHtml: parsed.data.headHtml ?? null,
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

webPageRouter.delete("/:id", p.delete, async (req, res) => {
  await prisma.webPage.deleteMany({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  res.status(204).end();
});

// ── Public (no auth) ────────────────────────────────────────────────────
// Returns JSON — the portal-web renderer fetches this and renders into the
// PortalShell's public branch. Serving raw HTML from the API would work but
// keeping it JSON lets the client do markdown/HTML transformations later.
webPagePublicRouter.get("/:slug", async (req, res) => {
  const page = await prisma.webPage.findUnique({
    where: { publicSlug: req.params.slug },
  });
  if (!isPubliclyReadable(page))
    return res.status(404).json({ error: "Not found" });
  res.json({
    slug: page.publicSlug,
    title: page.title,
    description: page.description,
    bodyHtml: page.bodyHtml,
    headHtml: page.headHtml,
    publishedAt: page.publishedAt,
  });
});
