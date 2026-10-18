// Idempotency-key sweeper — prunes IdempotencyKey rows whose expiresAt has
// passed. Without this the table grows monotonically; each retryable POST
// leaves a row that's only useful for the 24h TTL window.
//
// Cheap: single indexed DELETE on expiresAt. Safe to run frequently; every
// tick either does nothing or removes a bounded batch.

import { prisma } from "@lumaara/db";

export interface IdempotencySweepResult {
  deleted: number;
}

export async function runIdempotencySweepTick(): Promise<IdempotencySweepResult> {
  const { count } = await prisma.idempotencyKey.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return { deleted: count };
}
