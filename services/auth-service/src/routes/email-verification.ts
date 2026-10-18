import { Router } from "express";
import { z } from "zod";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@lumaara/db";
import { requireAuth } from "@lumaara/service-auth";
import { includeDevToken, sendMail } from "../lib/mail";

// Email verification. New signups start with `emailVerifiedAt = null`. Login
// still works (soft-verify) but the UI shows a banner asking to verify. A
// verified email is a prerequisite for password reset in prod (deferred).
//
// Endpoints:
//   POST /verify-email/request      — authenticated; issue + send token
//   POST /verify-email/confirm      — public; token + email → activate
//   POST /verify-email/resend-for-signup — post-signup public path (email + tenantSlug)

export const emailVerificationRouter = Router();

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const RESET_BASE_URL =
  process.env.NEXT_PUBLIC_SHELL_URL ?? "http://localhost:3000";

function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

async function issueAndSend(userId: string, email: string, tenantSlug: string) {
  const raw = randomBytes(32).toString("base64url");
  await prisma.emailVerificationToken.create({
    data: {
      userId,
      tokenHash: sha256Hex(raw),
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    },
  });
  const url = `${RESET_BASE_URL}/verify-email?token=${raw}&tenant=${encodeURIComponent(tenantSlug)}`;
  await sendMail({
    to: email,
    subject: "Verify your lumaara email",
    text: `Please verify your email by clicking:\n\n${url}\n\nLink expires in 24 hours.`,
  });
  return raw;
}

// Export for use in signup — creates the initial verification token.
export async function sendInitialVerification(userId: string, email: string, tenantSlug: string) {
  return issueAndSend(userId, email, tenantSlug);
}

// Authenticated user requests a fresh verification email.
emailVerificationRouter.post("/request", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.auth!.userId },
    include: { tenant: { select: { slug: true } } },
  });
  if (!user) return res.status(404).json({ error: "User not found" });
  if (user.emailVerifiedAt) return res.status(400).json({ error: "Already verified" });

  // Invalidate any outstanding tokens so we always have exactly one active.
  await prisma.emailVerificationToken.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  const raw = await issueAndSend(user.id, user.email, user.tenant.slug);
  res.json(includeDevToken({ ok: true }, raw));
});

// Public resend by email + tenant, for the "check your email" screen right
// after signup. Always 200 to avoid enumeration.
const resendSchema = z.object({
  email: z.string().email(),
  tenantSlug: z.string().min(1),
});
emailVerificationRouter.post("/resend-for-signup", async (req, res) => {
  const parsed = resendSchema.safeParse(req.body);
  if (!parsed.success) return res.json({ ok: true });
  const tenant = await prisma.tenant.findUnique({
    where: { slug: parsed.data.tenantSlug },
  });
  if (!tenant) return res.json({ ok: true });
  const user = await prisma.user.findUnique({
    where: { tenantId_email: { tenantId: tenant.id, email: parsed.data.email } },
  });
  if (!user || user.emailVerifiedAt) return res.json({ ok: true });
  await prisma.emailVerificationToken.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  const raw = await issueAndSend(user.id, user.email, tenant.slug);
  res.json(includeDevToken({ ok: true }, raw));
});

const confirmSchema = z.object({
  token: z.string().min(20),
});
emailVerificationRouter.post("/confirm", async (req, res) => {
  const parsed = confirmSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const rec = await prisma.emailVerificationToken.findUnique({
    where: { tokenHash: sha256Hex(parsed.data.token) },
  });
  if (!rec || rec.usedAt || rec.expiresAt < new Date())
    return res.status(400).json({ error: "Invalid or expired token" });

  await prisma.$transaction([
    prisma.user.update({
      where: { id: rec.userId },
      data: { emailVerifiedAt: new Date() },
    }),
    prisma.emailVerificationToken.update({
      where: { id: rec.id },
      data: { usedAt: new Date() },
    }),
  ]);
  res.json({ ok: true });
});
