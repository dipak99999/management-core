// Graceful shutdown helper — call once per service, right after
// `app.listen(...)` returns. On SIGTERM / SIGINT:
//   1. stop accepting new connections (server.close())
//   2. drain in-flight requests up to `drainMs` (default 30s — matches
//      k8s / Fly.io terminationGracePeriodSeconds default)
//   3. disconnect Prisma so connection pool releases cleanly
//   4. exit 0 (clean) or 1 (drain timeout)
//
// Also handles unhandledRejection + uncaughtException — logs them and
// exits so the orchestrator restarts the pod on a truly bad state.

import type { Server } from "node:http";
import { prisma } from "@lumaara/db";
import { getLogger } from "./logger";

interface Options {
  drainMs?: number;
}

export function installGracefulShutdown(
  server: Server,
  serviceName: string,
  opts: Options = {},
): void {
  const drainMs = opts.drainMs ?? 30_000;
  const log = getLogger(serviceName);
  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      log.warn("second shutdown signal — forcing exit", { signal });
      process.exit(1);
    }
    shuttingDown = true;
    log.info("shutting down", { signal, drainMs });

    // Stop accepting new connections.
    const closed = new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("drain timeout")), drainMs),
    );

    try {
      await Promise.race([closed, timeout]);
      log.info("http drained", { signal });
    } catch (e) {
      log.warn("shutdown drain failed", { err: e instanceof Error ? e.message : String(e) });
    }

    try {
      await prisma.$disconnect();
      log.info("prisma disconnected");
    } catch (e) {
      log.warn("prisma disconnect failed", { err: e instanceof Error ? e.message : String(e) });
    }

    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  // Fatal — log + exit so the orchestrator restarts. Don't try to
  // continue: unhandled rejections leave the process in an inconsistent
  // state and any subsequent request may corrupt data.
  process.on("uncaughtException", (err) => {
    log.error("uncaughtException — exiting", { err });
    process.exit(1);
  });
  process.on("unhandledRejection", (reason) => {
    log.error("unhandledRejection — exiting", {
      reason: reason instanceof Error ? { message: reason.message, stack: reason.stack } : String(reason),
    });
    process.exit(1);
  });
}
