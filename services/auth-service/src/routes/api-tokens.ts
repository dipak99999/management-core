import { Router } from "express";
import { z } from "zod";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@lumaara/db";
import { requireAuth } from "@lumaara/service-auth";

export const apiTokenRouter = Router();

apiTokenRouter.use(requireAuth);

const createSchema = z.object({
  name: z.string().min(1).max(80),
  // Days until expiry. Null / omitted = never.
  expiresInDays: z.coerce.number().int().positive().max(365 * 5).optional(),
});

function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

// List the current user's tokens (never surfaces the raw token — that's shown
// once at creation and never again).
apiTokenRouter.get("/", async (req, res) => {
  const rows = await prisma.apiToken.findMany({
    where: { tenantId: req.auth!.tenantId, userId: req.auth!.userId },
    select: {
      id: true,
      name: true,
      prefix: true,
      createdAt: true,
      lastUsedAt: true,
      expiresAt: true,
      revokedAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
  res.json(rows);
});

// Issue a new token. Returns the raw token exactly once — client must save it.
apiTokenRouter.post("/", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const raw = "ont_" + randomBytes(24).toString("base64url"); // 32 chars after prefix
  const prefix = raw.slice(0, 8);
  const tokenHash = sha256Hex(raw);
  const expiresAt = parsed.data.expiresInDays
    ? new Date(Date.now() + parsed.data.expiresInDays * 86_400_000)
    : null;

  const row = await prisma.apiToken.create({
    data: {
      tenantId: req.auth!.tenantId,
      userId: req.auth!.userId,
      name: parsed.data.name,
      prefix,
      tokenHash,
      expiresAt,
    },
  });
  // 201 returns the ONLY chance to see the raw token.
  res.status(201).json({
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    expiresAt: row.expiresAt,
    token: raw,
    warning:
      "Save this token now — it will not be shown again. It grants the same access as your account.",
  });
});

// Soft-revoke — sets revokedAt so audit still knows the token existed.
apiTokenRouter.post("/:id/revoke", async (req, res) => {
  const row = await prisma.apiToken.findFirst({
    where: {
      id: req.params.id,
      tenantId: req.auth!.tenantId,
      userId: req.auth!.userId,
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  if (row.revokedAt) return res.status(400).json({ error: "Already revoked" });
  // Scrub tokenHash on the way out — same shape as GET /. Returning the raw
  // Prisma row here would leak the auth material (SHA-256 of the token) in
  // response bodies, which then land in proxy logs / client monitoring.
  const updated = await prisma.apiToken.update({
    where: { id: row.id },
    data: { revokedAt: new Date() },
    select: {
      id: true,
      name: true,
      prefix: true,
      createdAt: true,
      lastUsedAt: true,
      expiresAt: true,
      revokedAt: true,
    },
  });
  res.json(updated);
});

// Hard delete only allowed for revoked tokens (audit integrity).
apiTokenRouter.delete("/:id", async (req, res) => {
  const row = await prisma.apiToken.findFirst({
    where: {
      id: req.params.id,
      tenantId: req.auth!.tenantId,
      userId: req.auth!.userId,
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  if (!row.revokedAt)
    return res.status(400).json({ error: "Revoke first before deleting" });
  await prisma.apiToken.delete({ where: { id: row.id } });
  res.status(204).send();
});
