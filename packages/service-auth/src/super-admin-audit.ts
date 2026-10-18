import type { NextFunction, Request, Response } from "express";
import { prisma, writeChainedSuperAdminEntry } from "@lumaara/db";
import { getLogger } from "./logger";

// Middleware factory for the super-admin routers (auth-service /super/*).
//
// Writes one SuperAdminAuditLog row per request — writes AND reads — because
// every super-admin API hit is a cross-tenant privileged op by a human. The
// audit trail is hash-chained (see packages/db/src/audit-chain.ts) so a
// future compliance review can prove the log hasn't been tampered with.
//
// Mount order (in each super-* router's index.ts):
//
//   router.use(requireAuth, requireSuperAdmin, auditSuperAdmin("super-admin"));
//
// Payload capture is best-effort: req.body is JSON-stringified and clamped
// to 32KB; larger bodies are stored as the literal `"<truncated>"`.
//
// targetTenantId is inferred from req.params.tenantId when present. If the
// route doesn't carry a tenantId (e.g. GET /super/tenants list), the field
// is null and the operation is treated as a cross-tenant query.
//
// Failures to persist are logged but don't block the request — the request
// handler already returned by the time we hit `res.on("finish")`. For a
// hard-fail-closed stance in SOC 2 enforcement mode, flip to a pre-handler
// write + response-time patch, but that costs latency on every call.

const log = getLogger("super-admin-audit");

const PAYLOAD_MAX_BYTES = 32_000;

function safePayload(body: unknown): unknown {
  if (body == null) return null;
  try {
    const s = JSON.stringify(body);
    if (s.length > PAYLOAD_MAX_BYTES) return "<truncated>";
    return body;
  } catch {
    return "<unserializable>";
  }
}

export interface SuperAdminAuditOptions {
  // Short identifier for the operation surface — "super-admin",
  // "super-ai-providers", "super-billing-gateways". Lands in
  // SuperAdminAuditLog.operation so you can filter by surface.
  surface: string;
}

export function auditSuperAdmin(opts: SuperAdminAuditOptions | string) {
  const surface = typeof opts === "string" ? opts : opts.surface;

  return function (req: Request, res: Response, next: NextFunction) {
    res.on("finish", () => {
      const auth = req.auth;
      // Super-admin middleware already asserts auth presence — if we get
      // here without it, the request bypassed the router entirely.
      if (!auth) return;

      const targetTenantId =
        typeof req.params?.tenantId === "string" && req.params.tenantId.length > 0
          ? req.params.tenantId
          : null;

      // Only persist request bodies on state-changing ops. GET params
      // land in `path` which is already captured.
      const isWrite = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method);
      const payload = isWrite ? safePayload(req.body) : null;

      writeChainedSuperAdminEntry(prisma, {
        actorUserId: auth.userId,
        actorEmail: auth.email ?? null,
        targetTenantId,
        operation: `${surface}:${req.method} ${req.route?.path ?? req.path}`,
        method: req.method,
        path: req.originalUrl,
        ipAddress: req.ip ?? null,
        userAgent: req.header("user-agent") ?? null,
        statusCode: res.statusCode,
        payload: payload as import("@prisma/client").Prisma.InputJsonValue,
        reason:
          typeof req.body?.reason === "string" && req.body.reason.length < 2000
            ? req.body.reason
            : null,
      }).catch((e: unknown) => {
        log.error("super-admin audit write failed", {
          err: e instanceof Error ? e : new Error(String(e)),
          surface,
          path: req.originalUrl,
        });
      });
    });
    next();
  };
}
