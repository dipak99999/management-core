import { Router } from "express";
import { z } from "zod";
import { prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// Landing Pages — standalone marketing pages published at /public/pages/:slug.
// Body is raw HTML rendered verbatim; the operator's editor is a textarea
// (Zoho ships a drag-drop builder — we'll add later). Views + conversions
// are counted so campaigns can attribute revenue back.

export const landingPageRouter = Router();
export const landingPagePublicRouter = Router();
const p = perms("LandingPage");

const upsertSchema = z.object({
  name: z.string().min(1),
  publicSlug: z.string().min(1).regex(/^[a-z0-9-]+$/i, "slug must be alphanumeric + dashes"),
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  bodyHtml: z.string().min(1),
  headHtml: z.string().nullable().optional(),
  isPublished: z.boolean().optional(),
  linkedWebFormId: z.string().nullable().optional(),
});

landingPageRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.landingPage.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: { updatedAt: "desc" },
  });
  res.json(rows);
});

landingPageRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.landingPage.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

landingPageRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const row = await prisma.landingPage.create({
      data: {
        tenantId: req.auth!.tenantId,
        name: parsed.data.name,
        publicSlug: parsed.data.publicSlug,
        title: parsed.data.title,
        description: parsed.data.description ?? null,
        bodyHtml: parsed.data.bodyHtml,
        headHtml: parsed.data.headHtml ?? null,
        isPublished: parsed.data.isPublished ?? false,
        linkedWebFormId: parsed.data.linkedWebFormId ?? null,
      },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint"))
      return res.status(409).json({ error: "Name or slug already exists" });
    throw e;
  }
});

landingPageRouter.put("/:id", p.write, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.landingPage.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const row = await prisma.landingPage.update({
    where: { id: existing.id },
    data: {
      name: parsed.data.name,
      publicSlug: parsed.data.publicSlug,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      bodyHtml: parsed.data.bodyHtml,
      headHtml: parsed.data.headHtml ?? null,
      isPublished: parsed.data.isPublished ?? existing.isPublished,
      linkedWebFormId: parsed.data.linkedWebFormId ?? null,
    },
  });
  res.json(row);
});

landingPageRouter.delete("/:id", p.delete, async (req, res) => {
  await prisma.landingPage.deleteMany({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  res.status(204).end();
});

// ── Public — render ────────────────────────────────────────────────────

landingPagePublicRouter.get("/:slug", async (req, res) => {
  const page = await prisma.landingPage.findUnique({
    where: { publicSlug: req.params.slug },
  });
  if (!page || !page.isPublished) return res.status(404).send("<h1>404 — page not found</h1>");

  // Fire-and-forget view logging.
  void prisma.landingPageView.create({
    data: {
      pageId: page.id,
      ipAddress: (req.ip ?? "").split(",")[0]?.trim() || null,
      userAgent: req.header("user-agent") ?? null,
      referrer: req.header("referer") ?? null,
      utm: extractUtm(req.query) ?? undefined,
    },
  }).catch(() => {});
  void prisma.landingPage.update({
    where: { id: page.id },
    data: { viewCount: { increment: 1 } },
  }).catch(() => {});

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(page.title)}</title>
${page.description ? `<meta name="description" content="${escapeHtml(page.description)}"/>` : ""}
${page.headHtml ?? ""}
</head><body>
${page.bodyHtml}
</body></html>`);
});

function extractUtm(q: Record<string, unknown>): Record<string, string> | null {
  const keys = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];
  const out: Record<string, string> = {};
  for (const k of keys) if (typeof q[k] === "string") out[k] = q[k] as string;
  return Object.keys(out).length ? out : null;
}

function escapeHtml(s: string | null | undefined): string {
  return String(s ?? "").replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] as string
  ));
}
