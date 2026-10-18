// Marketing P2 — Journey engine tick.
//
// Every JOURNEY_TICK_MS (default 30 s) we scan JourneyEnrollment for rows
// whose status is Active and whose nextTickAt is due, and hand each to
// `advanceEnrollment` (packages/db/src/journey.ts). Per-enrollment errors
// are captured on the row by advanceEnrollment itself, so the outer loop
// does not need to catch — but we defensively catch anyway so a single
// bad enrollment can't abort the batch.
//
// The runner is opt-in via JOURNEY_TICK_ENABLE=1 so we don't fire it in
// environments (e.g. some CI) that don't want marketing side-effects. The
// scheduler wires the ticker conditionally on that flag.

import { advanceEnrollment, prisma, withCrossTenant } from "@lumaara/db";
import { getLogger } from "@lumaara/service-auth";

const log = getLogger("scheduler");

export interface JourneyTickResult {
  processed: number;
  advanced: number;
  waiting: number;
  completed: number;
  failed: number;
  errors: number;
}

/** Configurable batch cap — defaults keep the tick cheap. */
function batchSize(): number {
  const n = Number(process.env.JOURNEY_TICK_BATCH ?? 100);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 500) : 100;
}

/**
 * One journey-engine tick. Pulls up to N due enrollments across all
 * tenants (withCrossTenant — the tenantId lives on the enrollment row and
 * flows into every downstream call).
 */
export async function runJourneyTick(): Promise<JourneyTickResult> {
  const now = new Date();
  const rows = await prisma.journeyEnrollment.findMany(
    withCrossTenant({
      where: {
        status: "Active",
        nextTickAt: { lte: now },
      },
      select: { id: true },
      orderBy: { nextTickAt: "asc" as const },
      take: batchSize(),
    }),
  );

  let advanced = 0;
  let waiting = 0;
  let completed = 0;
  let failed = 0;
  let errors = 0;

  for (const r of rows) {
    try {
      const res = await advanceEnrollment(prisma, r.id);
      switch (res.status) {
        case "advanced":
          advanced++;
          break;
        case "waiting":
          waiting++;
          break;
        case "completed":
          completed++;
          break;
        case "failed":
          failed++;
          break;
      }
    } catch (e) {
      // advanceEnrollment already writes lastError on the row for expected
      // failures — anything that reaches here is a deeper Prisma / infra
      // issue we can only log and skip.
      errors++;
      log.warn("journey advance threw", {
        enrollmentId: r.id,
        err: e instanceof Error ? e : new Error(String(e)),
      });
    }
  }

  return { processed: rows.length, advanced, waiting, completed, failed, errors };
}
