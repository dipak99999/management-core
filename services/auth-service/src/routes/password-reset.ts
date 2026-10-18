import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@lumaara/db";
import { BCRYPT_COST, checkPasswordPolicy } from "@lumaara/service-auth";
import { includeDevToken, sendMail } from "../lib/mail";

// Password reset flow:
//   1. POST /password-reset/request { email, tenantSlug } → issues token,
//      mails link. Always returns 200 (no user-enumeration leak).
//   2. POST /password-reset/confirm { token, newPassword } → validates,
//      updates password, marks token used.

export const passwordResetRouter = Router();

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const RESET_BASE_URL =
  process.env.NEXT_PUBLIC_SHELL_URL ?? "http://localhost:3000";

function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

const requestSchema = z.object({
  email: z.string().email(),
  tenantSlug: z.string().min(1),
});

passwordResetRouter.post("/request", async (req, res) => {
  const parsed = requestSchema.safeParse(req.body);
  // Even on validation error, respond 200 to avoid probing.
  if (!parsed.success) return res.json({ ok: true });

  const tenant = await prisma.tenant.findUnique({
    where: { slug: parsed.data.tenantSlug },
  });
  if (!tenant) return res.json({ ok: true });

  const user = await prisma.user.findUnique({
    where: {
      tenantId_email: { tenantId: tenant.id, email: parsed.data.email },
    },
  });
  if (!user) return res.json({ ok: true });

  // Ownership pre-check: refuse to email a reset link to an address the
  // owner never proved control of. Prevents an attacker from using someone
  // else's forgotten unverified signup to grab the account — because the
  // link would land in an inbox the legitimate user doesn't monitor.
  // Opt-out with PASSWORD_RESET_REQUIRE_VERIFIED_EMAIL=0 (default is on
  // when NODE_ENV=production).
  const requireVerified =
    process.env.PASSWORD_RESET_REQUIRE_VERIFIED_EMAIL == null
      ? process.env.NODE_ENV === "production"
      : process.env.PASSWORD_RESET_REQUIRE_VERIFIED_EMAIL === "1";
  if (requireVerified && !user.emailVerifiedAt) {
    // Silent 200 — no user-enumeration side-channel. Ops can still see the
    // rejection in structured logs.
    // eslint-disable-next-line no-console
    console.warn(
      JSON.stringify({
        level: "warn",
        kind: "password-reset.refused",
        reason: "email-not-verified",
        userId: user.id,
        tenantId: tenant.id,
        time: new Date().toISOString(),
      }),
    );
    return res.json({ ok: true });
  }

  const raw = randomBytes(32).toString("base64url");
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: sha256Hex(raw),
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    },
  });

  const url = `${RESET_BASE_URL}/reset-password?token=${raw}&tenant=${encodeURIComponent(parsed.data.tenantSlug)}`;
  await sendMail({
    to: user.email,
    subject: "Reset your lumaara password",
    text: `Hi ${user.fullName},

Someone requested a password reset for your lumaara account. If this was you, follow the link below within 1 hour to set a new password:

${url}

If you didn't request this, ignore this email — your password is unchanged.`,
  });

  res.json(includeDevToken({ ok: true }, raw));
});

const confirmSchema = z.object({
  token: z.string().min(20),
  newPassword: z.string().min(8),
});

passwordResetRouter.post("/confirm", async (req, res) => {
  const parsed = confirmSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const violations = await checkPasswordPolicy(parsed.data.newPassword);
  if (violations)
    return res.status(400).json({ error: "Password too weak", violations });

  const rec = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: sha256Hex(parsed.data.token) },
  });
  if (!rec || rec.usedAt || rec.expiresAt < new Date())
    return res.status(400).json({ error: "Invalid or expired token" });

  const passwordHash = await bcrypt.hash(parsed.data.newPassword, BCRYPT_COST);
  const now = new Date();
  await prisma.$transaction([
    // Bump tokenEpoch so every JWT already in the wild (including jti-less
    // legacy tokens) fails the iat-vs-epoch check on the next request. See
    // packages/service-auth/src/index.ts requireAuth().
    prisma.user.update({
      where: { id: rec.userId },
      data: { passwordHash, tokenEpoch: now },
    }),
    // Revoke every unrevoked session so any JWT with a jti also dies
    // immediately, independent of the tokenEpoch belt.
    prisma.userSession.updateMany({
      where: { userId: rec.userId, revokedAt: null },
      data: { revokedAt: now },
    }),
    prisma.passwordResetToken.update({
      where: { id: rec.id },
      data: { usedAt: now },
    }),
    // Belt-and-suspenders: invalidate any other outstanding reset tokens for
    // this user so an attacker who intercepted one can't burn it after we
    // notice + reset.
    prisma.passwordResetToken.updateMany({
      where: { userId: rec.userId, usedAt: null, id: { not: rec.id } },
      data: { usedAt: now },
    }),
  ]);

  res.json({ ok: true });
});
