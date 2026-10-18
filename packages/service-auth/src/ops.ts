import type { NextFunction, Request, Response } from "express";
import { randomUUID, createHash } from "node:crypto";
import { prisma } from "@lumaara/db";
import { getLogger } from "./logger";

// M1: Structured logging + request-id. Attach a UUID to every request
// (honor an inbound X-Request-Id for cross-service tracing), log one JSON
// line per request on completion.

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

export function requestLogger(serviceName: string) {
  const log = getLogger(serviceName);
  return function (req: Request, res: Response, next: NextFunction) {
    const inbound = req.header("x-request-id");
    const id = inbound && /^[a-zA-Z0-9-]{8,64}$/.test(inbound) ? inbound : randomUUID();
    req.requestId = id;
    res.setHeader("x-request-id", id);
    const start = Date.now();
    res.on("finish", () => {
      const durMs = Date.now() - start;
      log.info("request", {
        requestId: id,
        method: req.method,
        path: req.originalUrl.split("?")[0],
        status: res.statusCode,
        durMs,
        tenantId: req.auth?.tenantId,
        userId: req.auth?.userId,
      });
      // M7: bump counters used by the metrics endpoint.
      incRequest(serviceName, req.method, res.statusCode, durMs);
    });
    next();
  };
}

// Mount the standard set of ops endpoints on `app` — /health (liveness),
// /health/ready (checks DB), and /metrics (Prometheus text). One-liner so
// every service can enable them without pulling in the full admin CRUD.
export function mountBasicOps(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app: any,
  serviceName: string,
): void {
  app.get("/health", (_req: unknown, res: { json: (v: unknown) => void }) =>
    res.json({ ok: true, service: serviceName }),
  );
  app.get(
    "/health/ready",
    async (
      _req: unknown,
      res: { status: (n: number) => { json: (v: unknown) => void } },
    ) => {
      const checks: Record<string, { ok: boolean; detail?: string }> = {};
      try {
        await prisma.$queryRaw`SELECT 1`;
        checks.db = { ok: true };
      } catch (e) {
        checks.db = { ok: false, detail: e instanceof Error ? e.message : "unknown" };
      }
      const ok = Object.values(checks).every((c) => c.ok);
      res.status(ok ? 200 : 503).json({ ok, checks, service: serviceName });
    },
  );
  app.get(
    "/metrics",
    (
      _req: unknown,
      res: {
        setHeader: (k: string, v: string) => void;
        send: (v: string) => void;
      },
    ) => {
      res.setHeader("content-type", "text/plain; version=0.0.4");
      res.send(renderMetrics(serviceName));
    },
  );
}

// M6: capture unhandled errors into ErrorLog. Wraps Express's default 4-arg
// error middleware — mount as the LAST handler after all routes.
//
// Also maps well-known error shapes to correct HTTP status codes:
//   - body-parser "entity too large" → 413
//   - CORS origin-not-allowed → 403
// All other errors → 500 with a redacted message.
export function errorCapture(serviceName: string) {
  const log = getLogger(serviceName);
  return async function (
    err: Error,
    req: Request,
    res: Response,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _next: NextFunction,
  ) {
    // Classify the error to pick the right status + user-facing message.
    // Never leak the raw exception message on 500s — internal details can
    // include SQL / stack info that helps an attacker fingerprint the stack.
    let status = 500;
    let userMessage = "Internal server error";
    const errType = (err as { type?: string }).type;
    if (errType === "entity.too.large" || err.message.includes("request entity too large")) {
      status = 413;
      userMessage = "Request body too large";
    } else if (
      err.message.startsWith("Origin ") &&
      err.message.includes("not allowed by CORS")
    ) {
      status = 403;
      userMessage = "Origin not allowed by CORS";
    } else if (err.message.startsWith("PayloadTooLargeError")) {
      status = 413;
      userMessage = "Request body too large";
    } else {
      // Prisma known request errors. Mapping the common codes keeps a
      // misbehaving query (FK violation on delete, duplicate on create)
      // from killing the service via unhandledRejection and returns a
      // meaningful status to the client.
      const code = (err as { code?: string }).code;
      if (code === "P2003") {
        // Foreign key constraint violation — row referenced by children.
        status = 409;
        userMessage =
          "Cannot delete: referenced by other records. Remove or reassign dependents first.";
      } else if (code === "P2002") {
        // Unique constraint violation.
        status = 409;
        userMessage = "A record with this value already exists.";
      } else if (code === "P2025") {
        // Record not found (where clause matched nothing).
        status = 404;
        userMessage = "Not found";
      }
    }

    log.error("request failed", {
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl.split("?")[0],
      status,
      err,
    });
    incError(serviceName);
    // Best-effort persist. Never swallow the response cycle if it fails.
    try {
      await prisma.errorLog.create({
        data: {
          tenantId: req.auth?.tenantId ?? null,
          service: serviceName,
          requestId: req.requestId ?? null,
          path: req.originalUrl.split("?")[0].slice(0, 500),
          method: req.method,
          statusCode: status,
          message: err.message.slice(0, 2000),
          stack: err.stack?.slice(0, 8000) ?? null,
          userId: req.auth?.userId ?? null,
          userAgent: req.header("user-agent")?.slice(0, 500) ?? null,
        },
      });
    } catch {
      // swallow
    }
    if (!res.headersSent) {
      res
        .status(status)
        .json({ error: userMessage, requestId: req.requestId });
    }
  };
}

// ---------- M7: in-memory Prometheus-style counters ----------
//
// Kept in-process (per-service pod). A real deployment would push these to a
// remote (Prometheus / OpenTelemetry). This is enough for demos / smoke.

const counters: Record<string, number> = {
  http_requests_total: 0,
  http_errors_total: 0,
};
const perStatus: Record<string, number> = {};
const perMethod: Record<string, number> = {};
let durSumMs = 0;

function incRequest(_service: string, method: string, status: number, durMs: number) {
  counters.http_requests_total += 1;
  perStatus[String(status)] = (perStatus[String(status)] ?? 0) + 1;
  perMethod[method] = (perMethod[method] ?? 0) + 1;
  durSumMs += durMs;
}
function incError(_service: string) {
  counters.http_errors_total += 1;
}

export function renderMetrics(serviceName: string): string {
  const lines: string[] = [];
  const svc = escapeLabel(serviceName);
  lines.push("# HELP http_requests_total Total HTTP requests");
  lines.push("# TYPE http_requests_total counter");
  lines.push(`http_requests_total{service="${svc}"} ${counters.http_requests_total}`);
  lines.push("# HELP http_errors_total HTTP 500-class errors");
  lines.push("# TYPE http_errors_total counter");
  lines.push(`http_errors_total{service="${svc}"} ${counters.http_errors_total}`);
  lines.push("# HELP http_request_duration_ms_sum Sum of request durations");
  lines.push("# TYPE http_request_duration_ms_sum counter");
  lines.push(`http_request_duration_ms_sum{service="${svc}"} ${durSumMs}`);
  lines.push("# HELP http_requests_by_status Requests grouped by status");
  lines.push("# TYPE http_requests_by_status counter");
  for (const [k, v] of Object.entries(perStatus)) {
    lines.push(`http_requests_by_status{service="${svc}",status="${k}"} ${v}`);
  }
  lines.push("# HELP http_requests_by_method Requests grouped by method");
  lines.push("# TYPE http_requests_by_method counter");
  for (const [k, v] of Object.entries(perMethod)) {
    lines.push(`http_requests_by_method{service="${svc}",method="${k}"} ${v}`);
  }
  return lines.join("\n") + "\n";
}

function escapeLabel(s: string): string {
  return s.replace(/[\\"\n]/g, "");
}

// ---------- M4: Feature Flag helper ----------
//
// Reads the tenant's FeatureFlag row. `rolloutPercent < 100` uses a stable
// hash of (tenantId, key) so a tenant's outcome doesn't flip between calls.

export async function isFeatureEnabled(tenantId: string, key: string): Promise<boolean> {
  const row = await prisma.featureFlag.findFirst({
    where: { tenantId, key },
  });
  if (!row || !row.enabled) return false;
  if (row.rolloutPercent >= 100) return true;
  if (row.rolloutPercent <= 0) return false;
  const bucket = tenantHashBucket(tenantId, key);
  return bucket < row.rolloutPercent;
}

function tenantHashBucket(tenantId: string, key: string): number {
  const h = createHash("sha256").update(`${tenantId}:${key}`).digest();
  // Take first 4 bytes → 0..255 range → normalize to 0..99.
  const n = h.readUInt32BE(0);
  return n % 100;
}
