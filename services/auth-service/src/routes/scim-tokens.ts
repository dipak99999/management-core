// Admin management for SCIM provisioning tokens. Separate router from
// the SCIM protocol itself (which lives at /scim/v2 and uses the token
// for its own auth) — this router is mounted at /settings/scim-tokens
// and uses the regular JWT auth so an admin can issue/revoke tokens.

import { Router } from "express";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "@lumaara/db";
import { perms, requireAuth } from "@lumaara/service-auth";

export const scimTokensRouter = Router();
scimTokensRouter.use(requireAuth);

// Only SystemManager (same as ApiToken) can mint SCIM tokens — these
// give unlimited user-provisioning rights for the whole tenant.
const p = perms("ApiToken");

const createSchema = z.object({
  name: z.string().min(1).max(80),
  defaultRole: z.string().min(1).max(60).default("admin"),
});

// Token format: `scim_` + 32 bytes hex (64 chars) = 69 chars total.
// Easy for operators to spot ("that long thing starting with scim_").
// Hash with sha256 before storing (same pattern as ApiToken).
function generateToken(): { raw: string; prefix: string; hash: string } {
  const bytes = randomBytes(32).toString("hex");
  const raw = `scim_${bytes}`;
  return {
    raw,
    prefix: raw.slice(0, 8),
    hash: createHash("sha256").update(raw).digest("hex"),
  };
}

scimTokensRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.scimToken.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: [{ revokedAt: "asc" }, { createdAt: "desc" }],
    select: {
      id: true,
      name: true,
      prefix: true,
      defaultRole: true,
      createdAt: true,
      lastUsedAt: true,
      revokedAt: true,
    },
  });
  res.json(rows);
});

scimTokensRouter.post("/", p.create, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { raw, prefix, hash } = generateToken();
  const row = await prisma.scimToken.create({
    data: {
      tenantId: req.auth!.tenantId,
      name: parsed.data.name,
      defaultRole: parsed.data.defaultRole,
      prefix,
      tokenHash: hash,
      createdByUserId: req.auth!.userId,
    },
    select: { id: true, name: true, prefix: true, defaultRole: true, createdAt: true },
  });
  // Return the raw token ONCE in the create response — the hash is one-way,
  // so losing this is losing it. The admin UI stashes it and prompts
  // the user to copy into the IdP connector.
  res.status(201).json({ ...row, token: raw });
});

scimTokensRouter.post("/:id/revoke", p.delete, async (req, res) => {
  const existing = await prisma.scimToken.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    select: { id: true, revokedAt: true },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.revokedAt) return res.status(409).json({ error: "Already revoked" });
  await prisma.scimToken.update({
    where: { id: existing.id },
    data: { revokedAt: new Date() },
  });
  res.status(204).send();
});

scimTokensRouter.delete("/:id", p.delete, async (req, res) => {
  const existing = await prisma.scimToken.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    select: { id: true },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.scimToken.delete({ where: { id: existing.id } });
  res.status(204).send();
});
