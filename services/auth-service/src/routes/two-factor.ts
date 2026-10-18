import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { authenticator } from "otplib";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@lumaara/db";
import { requireAuth } from "@lumaara/service-auth";

// TOTP 2FA endpoints. Auth flow:
//   1. POST /2fa/enroll — writes the secret (not yet active), returns secret +
//      otpauth:// URL. Client renders QR.
//   2. POST /2fa/verify — user submits a code from their authenticator, we
//      check + flip `totpEnabledAt`. Also mints 10 one-shot backup codes.
//   3. POST /2fa/disable — password re-auth + zero out.
//
// Login flow modification (in routes/auth.ts): if totpEnabledAt is set, the
// /login response becomes `{require2fa: true, challengeToken}` and the client
// must POST /2fa/challenge with a TOTP or backup code to get a real JWT.

export const twoFactorRouter = Router();

// Allow a 1-step window either side to tolerate mild clock skew.
authenticator.options = { window: 1 };

function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

// 8-char base32-ish backup codes. Human-copyable, easy to type.
function genBackupCode(): string {
  return randomBytes(6).toString("base64url").slice(0, 8).toUpperCase();
}

twoFactorRouter.use(requireAuth);

twoFactorRouter.post("/enroll", async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.auth!.userId } });
  if (!user) return res.status(404).json({ error: "User not found" });
  if (user.totpEnabledAt) return res.status(400).json({ error: "2FA already enabled" });

  const secret = authenticator.generateSecret();
  const tenant = await prisma.tenant.findUnique({
    where: { id: user.tenantId },
    select: { name: true },
  });
  const otpauthUrl = authenticator.keyuri(
    user.email,
    `lumaara (${tenant?.name ?? "tenant"})`,
    secret,
  );

  // Persist the secret pre-verification. If the user never completes verify,
  // the row stays as "enrolled-not-verified" — a subsequent enroll overwrites.
  await prisma.user.update({
    where: { id: user.id },
    data: { totpSecret: secret },
  });

  res.json({ secret, otpauthUrl });
});

twoFactorRouter.post("/verify", async (req, res) => {
  const parsed = z.object({ token: z.string().min(6).max(10) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const user = await prisma.user.findUnique({ where: { id: req.auth!.userId } });
  if (!user?.totpSecret)
    return res.status(400).json({ error: "Enroll first" });
  if (user.totpEnabledAt)
    return res.status(400).json({ error: "Already verified" });

  const ok = authenticator.check(parsed.data.token, user.totpSecret);
  if (!ok) return res.status(400).json({ error: "Invalid code" });

  // Generate 10 backup codes. Store hashes; return raw once.
  const backupCodes = Array.from({ length: 10 }, genBackupCode);
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { totpEnabledAt: new Date() },
    }),
    prisma.totpBackupCode.deleteMany({ where: { userId: user.id } }),
    prisma.totpBackupCode.createMany({
      data: backupCodes.map((c) => ({ userId: user.id, codeHash: sha256Hex(c) })),
    }),
  ]);

  res.json({
    enabled: true,
    backupCodes,
    warning:
      "Save these one-time backup codes now. Each works exactly once if you lose your authenticator.",
  });
});

twoFactorRouter.post("/disable", async (req, res) => {
  const parsed = z.object({ password: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const user = await prisma.user.findUnique({ where: { id: req.auth!.userId } });
  if (!user) return res.status(404).json({ error: "User not found" });
  const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
  if (!ok) return res.status(400).json({ error: "Invalid password" });

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { totpSecret: null, totpEnabledAt: null },
    }),
    prisma.totpBackupCode.deleteMany({ where: { userId: user.id } }),
  ]);
  res.json({ disabled: true });
});

// Regenerate backup codes (invalidates previous set). Requires password.
twoFactorRouter.post("/backup-codes", async (req, res) => {
  const parsed = z.object({ password: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const user = await prisma.user.findUnique({ where: { id: req.auth!.userId } });
  if (!user?.totpEnabledAt) return res.status(400).json({ error: "2FA not enabled" });
  const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
  if (!ok) return res.status(400).json({ error: "Invalid password" });

  const backupCodes = Array.from({ length: 10 }, genBackupCode);
  await prisma.$transaction([
    prisma.totpBackupCode.deleteMany({ where: { userId: user.id } }),
    prisma.totpBackupCode.createMany({
      data: backupCodes.map((c) => ({ userId: user.id, codeHash: sha256Hex(c) })),
    }),
  ]);
  res.json({ backupCodes });
});

// Status endpoint for the settings page.
twoFactorRouter.get("/status", async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.auth!.userId },
    select: { totpEnabledAt: true },
  });
  const remaining = user?.totpEnabledAt
    ? await prisma.totpBackupCode.count({
        where: { userId: req.auth!.userId, usedAt: null },
      })
    : 0;
  res.json({
    enabled: !!user?.totpEnabledAt,
    enabledAt: user?.totpEnabledAt ?? null,
    backupCodesRemaining: remaining,
  });
});

// ---------- Challenge helpers (used by /auth/login two-step) ----------

// Exported for auth.ts to consume on the challenge endpoint.
export async function verifyTotpOrBackup(
  userId: string,
  token: string,
): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.totpSecret || !user.totpEnabledAt) return false;
  // Try TOTP first (fast path).
  if (authenticator.check(token, user.totpSecret)) return true;
  // Then backup codes (one-shot).
  const codeHash = sha256Hex(token.toUpperCase());
  const backup = await prisma.totpBackupCode.findFirst({
    where: { userId, codeHash, usedAt: null },
  });
  if (!backup) return false;
  await prisma.totpBackupCode.update({
    where: { id: backup.id },
    data: { usedAt: new Date() },
  });
  return true;
}
