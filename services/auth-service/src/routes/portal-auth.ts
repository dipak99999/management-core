import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import { prisma, renderTemplate } from "@lumaara/db";
import {
  BCRYPT_COST,
  checkPasswordPolicy,
  perms,
  requireAuth,
  signPortalToken,
} from "@lumaara/service-auth";

// K2 + K8 + K10: Portal auth. Two audiences here:
//
//  1. Staff routes (require staff JWT) — invite creation, listing, disable.
//  2. Public routes (no JWT) — invite acceptance, login, forgot-password.
//
// The portal JWT is a separate secret / audience — see packages/service-auth/portal-auth.ts.

export const portalAuthRouter = Router();

// ----- Staff-side: invite management (K8) -----

const staffPerms = perms("PortalUser");

const inviteSchema = z.object({
  email: z.string().email(),
  partyType: z.enum(["Customer", "Supplier"]),
  partyId: z.string().min(1),
  displayName: z.string().optional().nullable(),
});

portalAuthRouter.get("/users", requireAuth, staffPerms.read, async (req, res) => {
  const auth = req.auth!;
  const partyType = typeof req.query.partyType === "string" ? req.query.partyType : undefined;
  const partyId = typeof req.query.partyId === "string" ? req.query.partyId : undefined;
  const rows = await prisma.portalUser.findMany({
    where: {
      tenantId: auth.tenantId,
      ...(partyType ? { partyType } : {}),
      ...(partyId ? { partyId } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
  res.json(rows);
});

portalAuthRouter.post("/invite", requireAuth, staffPerms.create, async (req, res) => {
  const parsed = inviteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;

  // Verify the party exists in the tenant.
  const party =
    parsed.data.partyType === "Customer"
      ? await prisma.customer.findFirst({
          where: { id: parsed.data.partyId, tenantId },
          select: { customerName: true },
        })
      : await prisma.supplier.findFirst({
          where: { id: parsed.data.partyId, tenantId },
          select: { supplierName: true },
        });
  if (!party) return res.status(400).json({ error: "Invalid party" });

  // Upsert the PortalUser (email unique per tenant).
  const user = await prisma.portalUser.upsert({
    where: {
      tenantId_email: { tenantId, email: parsed.data.email.toLowerCase() },
    },
    update: {
      partyType: parsed.data.partyType,
      partyId: parsed.data.partyId,
      displayName: parsed.data.displayName ?? null,
      isActive: true,
    },
    create: {
      tenantId,
      email: parsed.data.email.toLowerCase(),
      partyType: parsed.data.partyType,
      partyId: parsed.data.partyId,
      displayName: parsed.data.displayName ?? null,
    },
  });

  // Mint a single-use invite token.
  const token = randomBytes(24).toString("base64url");
  const tokenHash = sha(token);
  const expiresAt = new Date(Date.now() + 7 * 24 * 3600_000); // 7 days
  await prisma.portalInvite.create({
    data: {
      tenantId,
      portalUserId: user.id,
      tokenHash,
      expiresAt,
    },
  });

  // Enqueue invite email via Phase F queue.
  const portalBase = process.env.PORTAL_PUBLIC_URL ?? "http://localhost:3007";
  const link = `${portalBase}/portal/accept-invite?token=${token}`;
  const partyName =
    parsed.data.partyType === "Customer"
      ? (party as { customerName: string }).customerName
      : (party as { supplierName: string }).supplierName;
  await prisma.emailMessage.create({
    data: {
      tenantId,
      toEmail: user.email,
      subject: `You're invited to the ${partyName} portal`,
      body: renderTemplate(
        `<p>Hi {{name}},</p><p>An account was created for you to access the {{party}} self-service portal.</p><p><a href="{{link}}">Set your password &amp; sign in</a></p><p>This link expires in 7 days.</p>`,
        {
          name: user.displayName ?? user.email,
          party: partyName,
          link,
        },
      ),
    },
  });

  res.status(201).json({ portalUserId: user.id, inviteLink: link });
});

portalAuthRouter.post("/users/:id/disable", requireAuth, staffPerms.write, async (req, res) => {
  const auth = req.auth!;
  const existing = await prisma.portalUser.findFirst({
    where: { id: req.params.id, tenantId: auth.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const row = await prisma.portalUser.update({
    where: { id: existing.id },
    data: { isActive: !existing.isActive },
  });
  res.json(row);
});

// ----- Public-side: accept / login / forgot / me -----

const acceptSchema = z.object({
  token: z.string().min(10),
  password: z.string().min(8),
});

portalAuthRouter.post("/accept", async (req, res) => {
  const parsed = acceptSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const violations = await checkPasswordPolicy(parsed.data.password);
  if (violations)
    return res.status(400).json({ error: "Password too weak", violations });

  const invite = await prisma.portalInvite.findUnique({
    where: { tokenHash: sha(parsed.data.token) },
    include: { portalUser: true },
  });
  if (!invite || invite.consumedAt || invite.expiresAt < new Date())
    return res.status(400).json({ error: "Invite invalid or expired" });

  const hash = await bcrypt.hash(parsed.data.password, BCRYPT_COST);
  await prisma.$transaction(async (tx) => {
    await tx.portalUser.update({
      where: { id: invite.portalUserId },
      data: { passwordHash: hash, isActive: true },
    });
    await tx.portalInvite.update({
      where: { id: invite.id },
      data: { consumedAt: new Date() },
    });
  });

  const token = signPortalToken({
    portalUserId: invite.portalUser.id,
    tenantId: invite.portalUser.tenantId,
    partyType: invite.portalUser.partyType as "Customer" | "Supplier",
    partyId: invite.portalUser.partyId,
    email: invite.portalUser.email,
  });
  res.json({ token, user: pickPortalUser(invite.portalUser) });
});

const loginSchema = z.object({
  tenantSlug: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(1),
});

portalAuthRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenant = await prisma.tenant.findUnique({
    where: { slug: parsed.data.tenantSlug },
  });
  if (!tenant) return res.status(401).json({ error: "Invalid credentials" });
  const user = await prisma.portalUser.findFirst({
    where: {
      tenantId: tenant.id,
      email: parsed.data.email.toLowerCase(),
      isActive: true,
    },
  });
  if (!user || !user.passwordHash)
    return res.status(401).json({ error: "Invalid credentials" });
  const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: "Invalid credentials" });

  await prisma.portalUser.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  const token = signPortalToken({
    portalUserId: user.id,
    tenantId: user.tenantId,
    partyType: user.partyType as "Customer" | "Supplier",
    partyId: user.partyId,
    email: user.email,
  });
  res.json({ token, user: pickPortalUser(user) });
});

// K10: forgot-password + change-password.
const forgotSchema = z.object({
  tenantSlug: z.string().min(1),
  email: z.string().email(),
});

portalAuthRouter.post("/forgot-password", async (req, res) => {
  const parsed = forgotSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenant = await prisma.tenant.findUnique({
    where: { slug: parsed.data.tenantSlug },
  });
  if (!tenant) return res.json({ ok: true }); // don't leak tenant existence
  const user = await prisma.portalUser.findFirst({
    where: {
      tenantId: tenant.id,
      email: parsed.data.email.toLowerCase(),
      isActive: true,
    },
  });
  if (!user) return res.json({ ok: true });

  const token = randomBytes(24).toString("base64url");
  await prisma.portalInvite.create({
    data: {
      tenantId: tenant.id,
      portalUserId: user.id,
      tokenHash: sha(token),
      expiresAt: new Date(Date.now() + 60 * 60_000), // 1 hour
    },
  });
  const portalBase = process.env.PORTAL_PUBLIC_URL ?? "http://localhost:3007";
  const link = `${portalBase}/portal/accept-invite?token=${token}`;
  await prisma.emailMessage.create({
    data: {
      tenantId: tenant.id,
      toEmail: user.email,
      subject: "Reset your portal password",
      body: `<p>Use this link to reset your password (valid 60 minutes):</p><p><a href="${link}">${link}</a></p>`,
    },
  });
  res.json({ ok: true });
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

// This one uses the portal JWT via requirePortalAuth (imported by consumer).
portalAuthRouter.post("/change-password", async (req, res) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  if (!req.portal) return res.status(401).json({ error: "Portal auth required" });

  const violations = await checkPasswordPolicy(parsed.data.newPassword);
  if (violations)
    return res.status(400).json({ error: "Password too weak", violations });

  const user = await prisma.portalUser.findFirst({
    where: { id: req.portal.portalUserId, tenantId: req.portal.tenantId },
  });
  if (!user?.passwordHash) return res.status(400).json({ error: "No password set" });
  const ok = await bcrypt.compare(parsed.data.currentPassword, user.passwordHash);
  if (!ok) return res.status(401).json({ error: "Current password wrong" });
  const hash = await bcrypt.hash(parsed.data.newPassword, BCRYPT_COST);
  await prisma.portalUser.update({
    where: { id: user.id },
    data: { passwordHash: hash, tokenEpoch: new Date() },
  });
  res.json({ ok: true });
});

portalAuthRouter.get("/me", async (req, res) => {
  if (!req.portal) return res.status(401).json({ error: "Portal auth required" });
  const user = await prisma.portalUser.findFirst({
    where: { id: req.portal.portalUserId, tenantId: req.portal.tenantId },
  });
  if (!user) return res.status(404).json({ error: "Not found" });
  res.json(pickPortalUser(user));
});

function pickPortalUser(u: {
  id: string;
  email: string;
  displayName: string | null;
  partyType: string;
  partyId: string;
  tenantId: string;
}) {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    partyType: u.partyType,
    partyId: u.partyId,
    tenantId: u.tenantId,
  };
}

function sha(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}
