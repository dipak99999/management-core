// Sentry wrapper — env-gated via SENTRY_DSN. No-op when unset so dev,
// CI and self-hosters-without-Sentry pay zero cost + see no behaviour
// change.
//
// Already covered by our own infrastructure:
//   - ErrorLog table captures every 500 (ops.ts errorCapture)
//   - Structured JSON logs (ops.ts requestLogger)
//   - OpenTelemetry traces (otel.ts)
//   - Crash handlers persist process-level failures to ErrorLog
//
// What Sentry adds on top:
//   - Issue grouping across replicas (vs scrolling log aggregator)
//   - Breadcrumbs leading up to a crash
//   - Release tracking (correlate errors with deploys via APP_VERSION)
//   - Alerting + Slack/PagerDuty integrations without re-building them
//
// If you don't want Sentry, leave SENTRY_DSN unset. The module stays
// linked but doesn't call Sentry.init() — the SDK init is what imposes
// runtime overhead.

import * as Sentry from "@sentry/node";
import type { Request, Response, NextFunction } from "express";

let initialized = false;

export function initSentry(serviceName: string): void {
  if (initialized) return;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return; // no-op in dev + any deploy that doesn't want Sentry

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    release: process.env.APP_VERSION ?? "unknown",
    serverName: serviceName,
    // Capture 10% of transactions by default — tune via SENTRY_SAMPLE_RATE.
    // Full-rate sampling on a busy service drowns the Sentry quota fast.
    tracesSampleRate: Number(process.env.SENTRY_SAMPLE_RATE ?? 0.1),
    // Scrub common secret-shaped keys before send. Belt + suspenders —
    // our own logger already redacts, but Sentry breadcrumbs can
    // snapshot req.body / headers unless we tell it not to.
    beforeSend(event) {
      if (event.request?.headers) {
        for (const h of ["authorization", "cookie", "x-api-key"]) {
          if (event.request.headers[h]) event.request.headers[h] = "[REDACTED]";
        }
      }
      return event;
    },
  });

  initialized = true;
  // One stdout line so operators can `grep '"sentry": "initialized"'` in
  // logs to confirm the DSN was accepted at boot.
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({
    level: "info",
    service: serviceName,
    sentry: "initialized",
    release: process.env.APP_VERSION ?? "unknown",
  }));
}

export function isSentryActive(): boolean {
  return initialized;
}

/**
 * Capture an exception with optional tenant/user context. Safe to call
 * when Sentry isn't initialized — short-circuits to a no-op. Use in
 * places where we already log the error (routes 500s, crash handlers)
 * so Sentry becomes a parallel sink, not a replacement.
 */
export function captureException(
  err: unknown,
  ctx: {
    tenantId?: string | null;
    userId?: string | null;
    requestId?: string | null;
    tags?: Record<string, string>;
  } = {},
): void {
  if (!initialized) return;
  Sentry.withScope((scope) => {
    if (ctx.tenantId) scope.setTag("tenantId", ctx.tenantId);
    if (ctx.userId) scope.setUser({ id: ctx.userId });
    if (ctx.requestId) scope.setTag("requestId", ctx.requestId);
    if (ctx.tags) {
      for (const [k, v] of Object.entries(ctx.tags)) scope.setTag(k, v);
    }
    Sentry.captureException(err);
  });
}

/**
 * Express error middleware. Mount AFTER errorCapture — this is a
 * separate middleware so we don't double-capture (errorCapture persists
 * to ErrorLog; this ships to Sentry). Pass-through regardless of Sentry
 * state so the chain stays intact.
 */
export function sentryErrorMiddleware(
  err: Error,
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (initialized) {
    captureException(err, {
      tenantId: req.auth?.tenantId,
      userId: req.auth?.userId,
      requestId: req.requestId,
      tags: { method: req.method, path: req.path.slice(0, 100) },
    });
  }
  next(err);
}
