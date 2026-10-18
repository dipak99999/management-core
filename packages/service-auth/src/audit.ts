import type { NextFunction, Request, Response } from "express";
import { prisma, writeChainedAuditEntry } from "@lumaara/db";
import { getLogger } from "./logger";

const log = getLogger("audit-middleware");

// Middleware factory that appends an AuditLog row for every state-changing
// request (POST/PUT/DELETE). GET is skipped to keep the log tight — reads
// aren't audit-worthy for MVP (SOC2-mode can extend later).
//
// The middleware runs AFTER the route handler by hooking into `res.on("finish")`,
// so we know the status code + whether the request actually succeeded. Failed
// writes still get logged (with statusCode >= 400) which is often useful for
// forensics.
//
// Doctype inference: parse the first URL segment against a caller-supplied
// map. e.g. `{"sales-invoices": "SalesInvoice"}`. Unknown paths default to
// the raw segment.

export interface AuditOptions {
  // Route-prefix → doctype-name map. Optional but recommended for cleaner logs.
  routeMap?: Record<string, string>;
}

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function auditMiddleware(opts: AuditOptions = {}) {
  const routeMap = opts.routeMap ?? {};
  return function (req: Request, res: Response, next: NextFunction) {
    if (!WRITE_METHODS.has(req.method)) return next();

    // Best-effort docId extraction: the segment right after the route prefix,
    // if it looks like a cuid or a submit/cancel-style action prefix.
    const parts = req.path.split("/").filter(Boolean);
    const prefix = parts[0] ?? "";
    const doctype = routeMap[prefix] ?? prefix;
    const docId =
      parts[1] && !parts[1].startsWith(":") && parts[1].length >= 8
        ? parts[1]
        : null;

    // Sub-action awareness: turns POST /sales-invoices/:id/submit into
    // "POST-submit" for clarity in the log.
    const action = parts[2] ? `${req.method}-${parts[2]}` : req.method;

    res.on("finish", () => {
      // Best-effort — don't block the response on log failure.
      const auth = req.auth;
      if (!auth) return; // unauthenticated writes shouldn't reach here anyway
      // Chained write — includes prevHash + entryHash + sequence for
      // SOC 2-grade tamper detection. See packages/db/src/audit-chain.ts.
      // Serialised per-tenant via a Postgres advisory lock so parallel
      // writers can't produce a divergent chain.
      writeChainedAuditEntry(prisma, {
        tenantId: auth.tenantId,
        userId: auth.userId,
        userEmail: auth.email,
        method: action,
        path: req.originalUrl,
        doctype: doctype || null,
        docId,
        ipAddress: req.ip ?? null,
        userAgent: req.header("user-agent") ?? null,
        statusCode: res.statusCode,
        // MVP: capture request body only on writes and only for smaller
        // payloads (skip large blobs like base64 attachments).
        payload:
          req.body && JSON.stringify(req.body).length < 32_000
            ? (req.body as unknown as import("@prisma/client").Prisma.InputJsonValue)
            : (undefined as unknown as import("@prisma/client").Prisma.InputJsonValue),
      }).catch((e: unknown) => {
        // Swallow — audit failures shouldn't crash the request. The
        // /audit-logs/verify endpoint will surface any missing rows on
        // the next SOC 2 audit run.
        log.error("audit write failed", {
          err: e instanceof Error ? e : new Error(String(e)),
        });
      });
    });

    next();
  };
}
