import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import {
  assignSystemManagerRole,
  getUserRoleNames,
  prisma,
  seedTenantChartOfAccounts,
} from "@lumaara/db";
import type { JwtClaims } from "@lumaara/shared-types";
import { BCRYPT_COST, JWT_SECRET, checkPasswordPolicy, getLogger } from "@lumaara/service-auth";

const log = getLogger("auth-service").child({ component: "auth" });
import { verifyTotpOrBackup } from "./two-factor";
import { sendInitialVerification } from "./email-verification";

export const authRouter = Router();

// Pre-2FA challenge JWT: only proves that email + password matched, and
// carries the userId + tenantId to redeem in the second step. Short TTL —
// user should complete the 2FA prompt within a few minutes.
interface ChallengeClaims {
  step: "pre-2fa";
  userId: string;
  tenantId: string;
}
function issueChallengeToken(userId: string, tenantId: string): string {
  return jwt.sign({ step: "pre-2fa", userId, tenantId } satisfies ChallengeClaims, JWT_SECRET, {
    expiresIn: "5m",
  });
}

const signupSchema = z.object({
  tenantName: z.string().min(2),
  tenantSlug: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9-]+$/, "slug must be lowercase alphanumeric with dashes"),
  fullName: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  tenantSlug: z.string().min(1),
});

function issueToken(claims: JwtClaims): string {
  return jwt.sign(
    claims as object,
    JWT_SECRET,
    {
      expiresIn: (process.env.JWT_EXPIRES_IN ?? "7d") as jwt.SignOptions["expiresIn"],
    },
  );
}

// Register a session row + issue a JWT stamped with its jti. Called at signup,
// login, and 2fa/challenge success.
async function issueTokenWithSession(
  base: Omit<JwtClaims, "jti">,
  req: import("express").Request,
): Promise<string> {
  const session = await prisma.userSession.create({
    data: {
      userId: base.userId,
      jti: randomUUID(),
      userAgent: req.header("user-agent") ?? null,
      ipAddress: req.ip ?? null,
    },
  });
  return issueToken({ ...base, jti: session.jti });
}

// Signup provisions a new tenant + its admin user in one atomic transaction.
authRouter.post("/signup", async (req, res) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { tenantName, tenantSlug, fullName, email, password } = parsed.data;

  const violations = await checkPasswordPolicy(password);
  if (violations)
    return res.status(400).json({ error: "Password too weak", violations });

  const existing = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
  if (existing) return res.status(409).json({ error: "Tenant slug already taken" });

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

  const { tenant, user, roles } = await prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({
      data: { name: tenantName, slug: tenantSlug },
    });
    const user = await tx.user.create({
      data: {
        tenantId: tenant.id,
        email,
        passwordHash,
        fullName,
        role: "admin",
      },
    });
    // Seed default Chart of Accounts + warehouses + currencies + system roles
    // (seedTenantDefaults now includes seedTenantRoles). If this fails, the
    // whole signup rolls back — no half-provisioned tenants.
    await seedTenantChartOfAccounts(tx, tenant.id);
    // First user on a tenant is the SystemManager.
    await assignSystemManagerRole(tx, tenant.id, user.id);
    const roles = await getUserRoleNames(tx, user.id);
    return { tenant, user, roles };
  });

  const token = await issueTokenWithSession(
    {
      userId: user.id,
      tenantId: tenant.id,
      email: user.email,
      role: user.role,
      roles,
    },
    req,
  );

  // Fire off the initial verification email. Don't block the signup response
  // on delivery — the mail is best-effort. Errors are surfaced to server logs
  // only.
  sendInitialVerification(user.id, user.email, tenant.slug).catch((e: unknown) => {
    log.error("signup verification email failed", {
      err: e instanceof Error ? e : new Error(String(e)),
      userId: user.id,
      tenantId: tenant.id,
    });
  });

  res.status(201).json({
    token,
    tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
    user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role, roles },
  });
});

// Account lockout — belt-and-braces on top of per-IP rate limiting.
// Catches botnet-distributed guesses (many IPs, one email) that stay under
// the per-IP limits. Configurable via env:
//   LOGIN_LOCKOUT_THRESHOLD  (default 10 failed attempts)
//   LOGIN_LOCKOUT_MINUTES    (default 15)
function loginLockoutConfig(): { threshold: number; ms: number } {
  const threshold = Number.parseInt(process.env.LOGIN_LOCKOUT_THRESHOLD ?? "10", 10);
  const minutes = Number.parseInt(process.env.LOGIN_LOCKOUT_MINUTES ?? "15", 10);
  return {
    threshold: Number.isFinite(threshold) && threshold > 0 ? threshold : 10,
    ms: (Number.isFinite(minutes) && minutes > 0 ? minutes : 15) * 60 * 1000,
  };
}

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { email, password, tenantSlug } = parsed.data;

  const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
  if (!tenant) return res.status(401).json({ error: "Invalid credentials" });

  const user = await prisma.user.findUnique({
    where: { tenantId_email: { tenantId: tenant.id, email } },
  });
  if (!user) return res.status(401).json({ error: "Invalid credentials" });

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    // Return the same 401 shape so the response doesn't leak whether the
    // account exists or is locked — an attacker learns nothing beyond
    // "credentials rejected".
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    // Increment failure counter; lock when threshold reached.
    const { threshold, ms } = loginLockoutConfig();
    const attempts = user.failedLoginAttempts + 1;
    const patch: { failedLoginAttempts: number; lockedUntil?: Date } = {
      failedLoginAttempts: attempts,
    };
    if (attempts >= threshold) {
      patch.lockedUntil = new Date(Date.now() + ms);
      log.warn("account locked", { userId: user.id, tenantId: tenant.id, attempts });
    }
    await prisma.user.update({ where: { id: user.id }, data: patch });
    return res.status(401).json({ error: "Invalid credentials" });
  }

  // Success — reset the counter + clear any lock.
  if (user.failedLoginAttempts > 0 || user.lockedUntil) {
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });
  }

  // Enforce email verification in production. `emailVerifiedAt` is set only
  // when the user clicks the link from /email-verification/verify. Opt-out
  // for a rollout window via SIGNUP_REQUIRE_EMAIL_VERIFY=0.
  const requireEmailVerify =
    process.env.SIGNUP_REQUIRE_EMAIL_VERIFY == null
      ? process.env.NODE_ENV === "production"
      : process.env.SIGNUP_REQUIRE_EMAIL_VERIFY === "1";
  if (requireEmailVerify && !user.emailVerifiedAt) {
    return res.status(403).json({
      error: "Email not verified",
      hint: "Check your inbox for the verification link, or POST /email-verification/resend to send a new one.",
      code: "EMAIL_NOT_VERIFIED",
    });
  }

  // If 2FA is enabled, step 1 returns a short-lived challenge token; the
  // client must POST /auth/2fa/challenge with a TOTP or backup code.
  if (user.totpEnabledAt) {
    return res.json({
      require2fa: true,
      challengeToken: issueChallengeToken(user.id, tenant.id),
    });
  }

  const roles = await getUserRoleNames(prisma, user.id);

  const token = await issueTokenWithSession(
    {
      userId: user.id,
      tenantId: tenant.id,
      email: user.email,
      role: user.role,
      roles,
    },
    req,
  );

  res.json({
    token,
    tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
    user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role, roles },
  });
});

const challengeSchema = z.object({
  challengeToken: z.string().min(10),
  code: z.string().min(6).max(10),
});
authRouter.post("/2fa/challenge", async (req, res) => {
  const parsed = challengeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  let claims: ChallengeClaims;
  try {
    claims = jwt.verify(
      parsed.data.challengeToken,
      JWT_SECRET,
    ) as ChallengeClaims;
  } catch {
    return res.status(401).json({ error: "Invalid or expired challenge" });
  }
  if (claims.step !== "pre-2fa")
    return res.status(401).json({ error: "Invalid challenge" });

  const ok = await verifyTotpOrBackup(claims.userId, parsed.data.code);
  if (!ok) return res.status(400).json({ error: "Invalid code" });

  const user = await prisma.user.findUnique({ where: { id: claims.userId } });
  const tenant = await prisma.tenant.findUnique({ where: { id: claims.tenantId } });
  if (!user || !tenant) return res.status(404).json({ error: "Not found" });

  const roles = await getUserRoleNames(prisma, user.id);
  const token = await issueTokenWithSession(
    {
      userId: user.id,
      tenantId: tenant.id,
      email: user.email,
      role: user.role,
      roles,
    },
    req,
  );

  res.json({
    token,
    tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
    user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role, roles },
  });
});

authRouter.get("/me", async (req, res) => {
  const auth = req.header("authorization");
  if (!auth?.startsWith("Bearer ")) return res.status(401).json({ error: "Missing token" });
  try {
    const claims = jwt.verify(
      auth.slice(7),
      JWT_SECRET,
    ) as JwtClaims;
    // Refresh roles + tenant locale from DB in case they changed since
    // the token was issued. Locale drives the client's `<LocaleProvider>`;
    // we surface it here so no second round-trip is needed.
    const [roles, tenant] = await Promise.all([
      getUserRoleNames(prisma, claims.userId),
      prisma.tenant.findUnique({
        where: { id: claims.tenantId },
        select: { locale: true, slug: true },
      }),
    ]);
    res.json({
      ...claims,
      roles,
      locale: tenant?.locale ?? "en",
      tenantSlug: tenant?.slug ?? null,
    });
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
});
