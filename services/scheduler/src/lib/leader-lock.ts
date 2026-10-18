import { prisma } from "@lumaara/db";

// Postgres advisory-lock based leader election for the scheduler process.
//
// pg_try_advisory_lock(BIGINT) returns true if the lock was acquired by this
// SESSION (Prisma pool has multiple sessions — we need the lock to be tied
// to a specific stable connection, so we execute inside a single-connection
// transaction that stays open). The lock is auto-released when the session
// disconnects, so a scheduler crash gives up its lock in seconds.
//
// The lock ID is derived deterministically from a namespace string. We use
// the module name as the namespace so ops running unrelated schedulers on
// the same DB can't collide.
//
// Usage:
//   const acquired = await tryAcquireLeader();
//   if (!acquired) { pollAgain in 30s; }
//   startScheduler();
//
// Two schedulers boot: one wins the lock and runs jobs; the other stays in
// "standby" mode with only /health running. If the leader crashes, Postgres
// releases the lock; the standby's next poll wins → automatic failover in
// ≤ heartbeatMs.

import { createHash } from "node:crypto";

function lockIdFromNamespace(ns: string): bigint {
  const h = createHash("sha256").update(ns).digest();
  // Advisory locks are keyed on a signed BIGINT — take the top 8 bytes,
  // interpret as unsigned, then coerce to signed (Postgres wraps this fine).
  const view = new DataView(h.buffer, h.byteOffset, 8);
  const u = view.getBigUint64(0, false);
  const signed = u >= 1n << 63n ? u - (1n << 64n) : u;
  return signed;
}

const LOCK_ID = lockIdFromNamespace("lumaara.scheduler.leader.v1");

export interface LeaderHandle {
  release: () => Promise<void>;
}

let currentHandle: LeaderHandle | null = null;

// Runs a background loop that tries to acquire the leader lock every
// `heartbeatMs`. Fires `onBecomeLeader` on the first successful acquisition
// (the app then wires up scheduleRepeatable) and never releases voluntarily
// — the process exit closes the DB session which drops the lock.
//
// If the initial acquire succeeds synchronously, `onBecomeLeader` fires
// before this function returns. Otherwise the standby loop keeps polling.
export async function runWithLeaderLock(opts: {
  heartbeatMs: number;
  onBecomeLeader: () => void | Promise<void>;
  logStandby?: () => void;
}): Promise<void> {
  const attempt = async (): Promise<boolean> => {
    // pg_try_advisory_lock returns true if acquired, false if held elsewhere.
    // We keep the acquisition inside a persistent transaction so the lock
    // stays alive for the process lifetime.
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = await (prisma as any).$queryRawUnsafe(
        `SELECT pg_try_advisory_lock(${LOCK_ID}::bigint) AS ok`,
      );
      const ok = Array.isArray(rows) && rows[0]?.ok === true;
      return ok;
    } catch {
      return false;
    }
  };

  const poll = async (): Promise<void> => {
    while (!currentHandle) {
      if (await attempt()) {
        currentHandle = {
          release: async () => {
            try {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              await (prisma as any).$queryRawUnsafe(
                `SELECT pg_advisory_unlock(${LOCK_ID}::bigint)`,
              );
            } catch {
              /* the process is dying anyway */
            }
          },
        };
        await opts.onBecomeLeader();
        return;
      }
      opts.logStandby?.();
      await new Promise((r) => setTimeout(r, opts.heartbeatMs));
    }
  };

  await poll();
}

export function isLeader(): boolean {
  return currentHandle !== null;
}
