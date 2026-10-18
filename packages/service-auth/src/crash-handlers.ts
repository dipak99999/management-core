import type { NextFunction, Request, Response } from "express";
import { prisma } from "@lumaara/db";

// Best-effort persist to ErrorLog. Swallows every failure — a crash handler
// that itself throws would mask the original crash, and DB may itself be the
// reason we're crashing. Returns quickly; callers can `await` before exit.
async function persistCrash(
  serviceName: string,
  kind: "unhandledRejection" | "uncaughtException",
  reason: unknown,
): Promise<void> {
  try {
    const message = reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error ? reason.stack : undefined;
    await prisma.errorLog.create({
      data: {
        tenantId: null,
        service: serviceName,
        requestId: null,
        path: `__${kind}`,
        method: "PROCESS",
        statusCode: 500,
        message: message.slice(0, 2000),
        stack: stack?.slice(0, 8000) ?? null,
        userId: null,
        userAgent: null,
      },
    });
  } catch {
    // swallow — DB may be the cause of the crash
  }
}

// Global crash handlers. Node's default behavior on unhandledRejection is
// to log + exit(1); we want to log with structure + let the operator's
// process manager decide restart policy. Keeping the process alive on a
// per-request Prisma failure (a common trigger) means the whole service
// doesn't drop all in-flight connections.
//
// Registering is a one-liner in each service's index.ts:
//   installCrashHandlers("service-name");
export function installCrashHandlers(serviceName: string): void {
  process.on("unhandledRejection", (reason: unknown) => {
    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify({
        level: "error",
        service: serviceName,
        kind: "unhandledRejection",
        message: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined,
        time: new Date().toISOString(),
      }),
    );
    // Fire-and-forget persist; we don't exit here so no need to await.
    void persistCrash(serviceName, "unhandledRejection", reason);
  });
  process.on("uncaughtException", (err: Error) => {
    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify({
        level: "error",
        service: serviceName,
        kind: "uncaughtException",
        message: err.message,
        stack: err.stack,
        time: new Date().toISOString(),
      }),
    );
    // For uncaught exceptions we DO exit — Node's docs recommend against
    // trying to continue since global state may be corrupted. Race the DB
    // write against a short timeout so a hung DB can't block restart.
    const deadline = new Promise<void>((r) => setTimeout(r, 1000));
    void Promise.race([
      persistCrash(serviceName, "uncaughtException", err),
      deadline,
    ]).finally(() => process.exit(1));
  });
  process.on("SIGTERM", () => {
    // eslint-disable-next-line no-console
    console.log(`[${serviceName}] SIGTERM received — shutting down`);
    process.exit(0);
  });
}

// Express error middleware that maps common exceptions to correct HTTP
// status codes and always returns JSON (never leaks a stack trace to the
// wire). Install with `app.use(jsonErrorHandler(serviceName))` at the very
// end of the middleware chain.
export function jsonErrorHandler(serviceName: string) {
  return function handler(
    err: unknown,
    req: Request,
    res: Response,
    _next: NextFunction,
  ): void {
    const isBodyTooLarge =
      err instanceof Error &&
      (err.message.includes("entity too large") ||
        (err as { type?: string }).type === "entity.too.large");
    if (isBodyTooLarge) {
      res.status(413).json({ error: "Request body too large (25 MB max)" });
      return;
    }
    const isCorsRejection =
      err instanceof Error && err.message.startsWith("Origin ") &&
      err.message.includes("not allowed by CORS");
    if (isCorsRejection) {
      res.status(403).json({ error: err.message });
      return;
    }
    // Structured log; never echo the stack to the response body.
    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify({
        level: "error",
        service: serviceName,
        kind: "request-error",
        path: req.originalUrl,
        method: req.method,
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
        time: new Date().toISOString(),
      }),
    );
    if (res.headersSent) return;
    res.status(500).json({
      error: "Internal server error",
      requestId: (req as { id?: string }).id,
    });
  };
}
