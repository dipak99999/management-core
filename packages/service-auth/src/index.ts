// Side-effect: parse workspace .env into process.env before any consumer
// imports validateEnv() or JWT_SECRET. Must stay above every other import.
import "./env-autoload";

// Side-effect: patches express's handler dispatcher so async errors thrown
// from route handlers propagate to the error-middleware (errorCapture)
// instead of surfacing as unhandledRejection and killing the service.
// Required for every service that uses `async (req, res) => { ... }`
// handlers — i.e. all of them. Combined with errorCapture's P2003/P2002
// Prisma mappings, this means a FK violation on delete returns 409 to
// the client instead of taking the service down.
import "express-async-errors";

import type { NextFunction, Request, Response } from "express";
import { createHash } from "node:crypto";
import jwt from "jsonwebtoken";
import { prisma, runWithTenant } from "@lumaara/db";
import type { AuthContext, JwtClaims } from "@lumaara/shared-types";
import { JWT_SECRET } from "./secrets";

// SHA-256 hex — used for both API token verification and secret comparisons.
function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

// Best-effort update — don't block the request. Called after successful API
// token auth.
async function touchApiToken(id: string): Promise<void> {
  try {
    await prisma.apiToken.update({
      where: { id },
      data: { lastUsedAt: new Date() },
    });
  } catch {
    // silent
  }
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

// ---------- Auth ----------

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const header = req.header("authorization");
  if (!header?.startsWith("Bearer "))
    return res.status(401).json({ error: "Missing token" });
  const raw = header.slice(7);

  // API tokens: fixed "ont_" prefix. Cheap dispatch, no crypto up-front.
  if (raw.startsWith("ont_")) {
    const tokenHash = sha256Hex(raw);
    const record = await prisma.apiToken.findUnique({
      where: { tokenHash },
      include: {
        user: {
          include: {
            userRoles: { include: { role: true } },
          },
        },
      },
    });
    if (!record || record.revokedAt || (record.expiresAt && record.expiresAt < new Date())) {
      return res.status(401).json({ error: "Invalid or revoked token" });
    }
    req.auth = {
      userId: record.userId,
      tenantId: record.tenantId,
      email: record.user.email,
      role: record.user.role,
      roles: record.user.userRoles.map((r) => r.role.roleName),
    };
    void touchApiToken(record.id);
    // Bind the tenantId into AsyncLocalStorage so RLS-wrapped Prisma
    // queries get SET LOCAL app.current_tenant_id applied. No-op when
    // RLS_ENFORCE != true. See packages/db/src/rls-context.ts.
    return runWithTenant(record.tenantId, () => next());
  }

  // JWTs are three base64url segments joined by dots. OAuth access tokens are
  // raw base64url (no dots). Use "." presence to dispatch.
  if (!raw.includes(".")) {
    const at = await prisma.oAuthAccessToken.findUnique({
      where: { tokenHash: sha256Hex(raw) },
      include: {
        client: { select: { tenantId: true } },
        user: {
          include: { userRoles: { include: { role: true } } },
        },
      },
    });
    if (!at || at.revokedAt || at.expiresAt < new Date())
      return res.status(401).json({ error: "Invalid or expired token" });
    if (!at.userId || !at.user) {
      // client_credentials — no user context.
      req.auth = {
        userId: `oauth-client:${at.clientId}`,
        tenantId: at.client.tenantId,
        email: `oauth-client@${at.clientId}`,
        role: "oauth-client",
        roles: [],
      };
    } else {
      req.auth = {
        userId: at.userId,
        tenantId: at.client.tenantId,
        email: at.user.email,
        role: at.user.role,
        roles: at.user.userRoles.map((r) => r.role.roleName),
      };
    }
    return runWithTenant(at.client.tenantId, () => next());
  }

  // Otherwise treat as a JWT.
  try {
    const claims = jwt.verify(raw, JWT_SECRET) as JwtClaims;
    // Belt-and-braces revocation:
    //   (1) Session revocation for JWTs with jti — issued after A10. The
    //       session-lookup lets an admin nuke a single session.
    //   (2) tokenEpoch check — a per-user monotonic clock bumped on password
    //       change / reset / admin-forced re-auth. Any token whose iat predates
    //       the current epoch is refused. Catches jti-less legacy tokens too.
    // Both checks piggyback on a single JOIN so the runtime cost is one query.
    const iatMs = typeof claims.iat === "number" ? claims.iat * 1000 : 0;
    if (claims.jti) {
      const session = await prisma.userSession.findUnique({
        where: { jti: claims.jti },
        include: { user: { select: { tokenEpoch: true } } },
      });
      if (!session || session.revokedAt)
        return res.status(401).json({ error: "Session revoked" });
      if (iatMs > 0 && session.user.tokenEpoch.getTime() > iatMs)
        return res.status(401).json({ error: "Token superseded by credential change" });
      // Best-effort update of lastActiveAt (fire-and-forget).
      void prisma.userSession
        .update({ where: { id: session.id }, data: { lastActiveAt: new Date() } })
        .catch(() => {});
    } else if (iatMs > 0 && claims.userId) {
      // Legacy jti-less token: one extra lookup for tokenEpoch. This path
      // ages out with the 7-day TTL after deployment, so the cost is bounded.
      const user = await prisma.user.findUnique({
        where: { id: claims.userId },
        select: { tokenEpoch: true },
      });
      if (!user)
        return res.status(401).json({ error: "User not found" });
      if (user.tokenEpoch.getTime() > iatMs)
        return res.status(401).json({ error: "Token superseded by credential change" });
    }
    req.auth = {
      userId: claims.userId,
      tenantId: claims.tenantId,
      email: claims.email,
      role: claims.role,
      roles: claims.roles ?? [],
    };
    runWithTenant(claims.tenantId, () => next());
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

// ---------- Permission gate ----------
//
// Checks whether the authenticated user's roles grant `action` on `doctype`.
// SystemManager short-circuits (has everything). All other roles hit the DB
// on first check per request and cache the result in `req.auth`.

interface AuthWithPerms extends AuthContext {
  _permCache?: Set<string>;
}

async function loadUserPerms(userId: string, tenantId: string): Promise<Set<string>> {
  const rows = await prisma.rolePermission.findMany({
    where: {
      tenantId,
      role: { userRoles: { some: { userId } } },
    },
    select: { doctype: true, action: true },
  });
  return new Set(rows.map((r) => `${r.doctype}:${r.action}`));
}

export function requirePerm(doctype: string, action: string) {
  return async function (req: Request, res: Response, next: NextFunction) {
    if (!req.auth) return res.status(401).json({ error: "Not authenticated" });
    const auth = req.auth as AuthWithPerms;

    // Short-circuit: SystemManager (or legacy admin flag) always allowed.
    if (auth.roles.includes("SystemManager") || auth.role === "admin") return next();

    try {
      if (!auth._permCache) {
        auth._permCache = await loadUserPerms(auth.userId, auth.tenantId);
      }
      if (auth._permCache.has(`${doctype}:${action}`)) return next();
      return res.status(403).json({
        error: `Forbidden: ${action} on ${doctype} requires a role that grants it`,
      });
    } catch (e) {
      return res.status(500).json({
        error: e instanceof Error ? e.message : "Permission check failed",
      });
    }
  };
}

export { workflowEndpoints } from "./workflow-endpoints";
export { corsMiddleware, buildCorsMiddleware, securityHeaders } from "./security";
export { JWT_SECRET, PORTAL_JWT_SECRET, UNSUBSCRIBE_SECRET } from "./secrets";
export { installCrashHandlers, jsonErrorHandler } from "./crash-handlers";
export {
  initSentry,
  isSentryActive,
  captureException,
  sentryErrorMiddleware,
} from "./sentry";
export { idempotency } from "./idempotency";
export { normalizeBody } from "./normalize-body";
export { getLogger } from "./logger";
export type { Logger, LogLevel } from "./logger";
export { customFieldsReadRouter } from "./custom-fields-endpoint";
export { featureFlagsEndpoint } from "./feature-flag-endpoint";
export { auditMiddleware } from "./audit";
export type { AuditOptions } from "./audit";
export { auditSuperAdmin } from "./super-admin-audit";
export type { SuperAdminAuditOptions } from "./super-admin-audit";
export {
  pdfLimiter,
  reportLimiter,
  apiLimiter,
  publicLimiter,
  aiLimiter,
  aiTenantDailyLimiter,
} from "./rate-limit";
export { requirePortalAuth, signPortalToken } from "./portal-auth";
export type { PortalContext, PortalJwtClaims } from "./portal-auth";
export {
  requestLogger,
  errorCapture,
  renderMetrics,
  isFeatureEnabled,
  mountBasicOps,
} from "./ops";
export { initOtel } from "./otel";
export { installGracefulShutdown } from "./graceful";
export { validateEnv } from "./env-validator";
export type { EnvSpec } from "./env-validator";
export {
  requireModule,
  requireSuperAdmin,
  invalidateSubscriptionCache,
} from "./require-module";
export {
  checkPasswordPolicy,
  validatePasswordShape,
  isPasswordBreached,
  BCRYPT_COST,
} from "./password-policy";
export type { PasswordPolicyViolation } from "./password-policy";
export {
  assertCompanyAccess,
  companyIdWhere,
  getAllowedCompanyIds,
  isCompanyAccessBypassed,
} from "./company-access";
export { publishRealtime } from "./realtime-publish";

// Convenience: many routes need to gate on a fixed doctype but vary action.
// Returns middlewares for common HTTP verbs against a given doctype so route
// files stay terse: `perms.read`, `perms.write`, `perms.submit`, etc.
export function perms(doctype: string) {
  return {
    read: requirePerm(doctype, "read"),
    write: requirePerm(doctype, "write"),
    create: requirePerm(doctype, "create"),
    delete: requirePerm(doctype, "delete"),
    submit: requirePerm(doctype, "submit"),
    cancel: requirePerm(doctype, "cancel"),
  };
}
