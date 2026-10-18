import { Router } from "express";
import { z } from "zod";
import {
  addSuppression,
  isSuppressed,
  prisma,
  removeSuppression,
} from "@lumaara/db";
import { perms, requireAuth } from "@lumaara/service-auth";

// Marketing P1: Suppression list CRUD. Backs the admin marketing UI page and
// serves as the manual entry point (support case, GDPR-erase request, CSV
// import). Auto-suppression on hard bounce / complaint happens inside
// crm-service's webhooks-inbound router via `normalizeAndPersist`, not here.

export const suppressionRouter = Router();
suppressionRouter.use(requireAuth);

const p = perms("Suppression");

const REASONS = ["HardBounce", "Complaint", "Manual", "GdprErase", "SpamFolder", "Import"] as const;

const createSchema = z.object({
  email: z.string().trim().email().max(320),
  reason: z.enum(REASONS).default("Manual"),
  detail: z.string().max(500).optional(),
});

const importItem = z.object({
  email: z.string().trim().email().max(320),
  reason: z.enum(REASONS).default("Import"),
  detail: z.string().max(500).optional(),
});
const importSchema = z.object({
  rows: z.array(importItem).min(1).max(10_000),
});

// GET /suppressions?reason=&search=&limit=&offset=
suppressionRouter.get("/", p.read, async (req, res) => {
  const reason = typeof req.query.reason === "string" ? req.query.reason : undefined;
  const search = typeof req.query.search === "string" ? req.query.search.trim().toLowerCase() : "";
  const limit = Math.min(500, Math.max(1, Number(req.query.limit ?? 100)));
  const offset = Math.max(0, Number(req.query.offset ?? 0));

  const [rows, total] = await Promise.all([
    prisma.suppression.findMany({
      where: {
        tenantId: req.auth!.tenantId,
        ...(reason && REASONS.includes(reason as (typeof REASONS)[number]) ? { reason } : {}),
        ...(search ? { email: { contains: search, mode: "insensitive" as const } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.suppression.count({
      where: {
        tenantId: req.auth!.tenantId,
        ...(reason && REASONS.includes(reason as (typeof REASONS)[number]) ? { reason } : {}),
        ...(search ? { email: { contains: search, mode: "insensitive" as const } } : {}),
      },
    }),
  ]);
  res.json({ rows, total });
});

// GET /suppressions/check?email= — cheap "is this address blocked?" lookup;
// used by transactional callers that want to pre-check before shipping.
suppressionRouter.get("/check", p.read, async (req, res) => {
  const email = typeof req.query.email === "string" ? req.query.email : "";
  if (!email) return res.status(400).json({ error: "email query required" });
  const row = await isSuppressed(prisma, req.auth!.tenantId, email);
  res.json({ suppressed: !!row, row });
});

// POST /suppressions
suppressionRouter.post("/", p.create, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const row = await addSuppression(prisma, req.auth!.tenantId, {
    email: parsed.data.email,
    reason: parsed.data.reason,
    source: "manual",
    detail: parsed.data.detail ?? null,
  });
  res.status(201).json(row);
});

// POST /suppressions/import — bulk add from CSV parse. Idempotent per row.
// Response: { inserted, skipped, errors: [{email, error}] }
suppressionRouter.post("/import", p.create, async (req, res) => {
  const parsed = importSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  let inserted = 0;
  let skipped = 0;
  const errors: { email: string; error: string }[] = [];
  for (const item of parsed.data.rows) {
    try {
      const before = await isSuppressed(prisma, tenantId, item.email);
      await addSuppression(prisma, tenantId, {
        email: item.email,
        reason: item.reason,
        source: "import",
        detail: item.detail ?? null,
      });
      if (before) skipped += 1;
      else inserted += 1;
    } catch (e) {
      errors.push({
        email: item.email,
        error: e instanceof Error ? e.message : "unknown error",
      });
    }
  }
  res.json({ inserted, skipped, errors });
});

// DELETE /suppressions/:id — remove single by row id (from admin UI actions).
suppressionRouter.delete("/:id", p.delete, async (req, res) => {
  const row = await prisma.suppression.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  await prisma.suppression.delete({ where: { id: row.id } });
  res.status(204).end();
});

// DELETE /suppressions/by-email — unsuppress by email (for retry-after-cleanup
// flows; e.g. GDPR erase reversal or manual review).
suppressionRouter.delete("/by-email/:email", p.delete, async (req, res) => {
  await removeSuppression(prisma, req.auth!.tenantId, req.params.email);
  res.status(204).end();
});
