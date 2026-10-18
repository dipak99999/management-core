import IORedis, { Redis } from "ioredis";
import { Queue, Worker, Job, QueueEvents, JobsOptions, WorkerOptions } from "bullmq";

// Async work runner for OpenNext ERP. Thin wrapper over BullMQ so callers
// don't touch Redis or BullMQ constructors directly.
//
// Two modes:
//   * Real mode  — REDIS_URL is set. Full BullMQ (persistent queue, retries,
//     backoff, distributed workers, DLQ).
//   * Inline mode — REDIS_URL is unset. `enqueue()` runs the handler in
//     setImmediate against the currently registered worker function. Nothing
//     persists across restarts. Purpose: unit tests + local dev without
//     Redis in docker. Never use in production — a crash mid-handler drops
//     the job silently.

let workerRedis: Redis | null = null;
let queueRedis: Redis | null = null;
let redisAttempted = false;

function attach(name: string, r: Redis): Redis {
  r.on("error", (e) => {
    // Log to stderr — never crash. ioredis reconnects on its own; if Redis
    // stays down the enqueue path fails fast (limited retries) but the
    // worker blocks on brpoplpush until Redis returns.
    // eslint-disable-next-line no-console
    console.error(`[queue:${name}] redis error:`, e.message);
  });
  return r;
}

function ensureConnections(): void {
  if (redisAttempted) return;
  redisAttempted = true;
  const url = process.env.REDIS_URL;
  if (!url) return;
  // Worker connection: BullMQ requires maxRetriesPerRequest=null so blocking
  // commands (BRPOPLPUSH) don't error out mid-poll.
  workerRedis = attach(
    "worker",
    new IORedis(url, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    }),
  );
  // Queue connection: limited retries + a hard command timeout so enqueue()
  // fails fast when Redis is unreachable (rather than hanging the HTTP
  // thread indefinitely).
  queueRedis = attach(
    "queue",
    new IORedis(url, {
      maxRetriesPerRequest: 3,
      commandTimeout: 10_000,
      enableReadyCheck: false,
    }),
  );
}

/** Long-lived worker connection (BullMQ blocking commands). */
export function getRedis(): Redis | null {
  ensureConnections();
  return workerRedis;
}

export function isQueueReal(): boolean {
  ensureConnections();
  return !!workerRedis;
}

// ---------- Queue registry ----------

const queues = new Map<string, Queue>();

export function getQueue(name: string): Queue | null {
  if (!isQueueReal()) return null;
  const existing = queues.get(name);
  if (existing) return existing;
  // Use the limited-retry connection so enqueue calls fail fast when Redis
  // is unreachable. Worker uses its own null-retry connection via startWorker.
  // Cast: bullmq's ConnectionOptions type resolves via its own hoisted
  // ioredis, which occasionally lands on a different exact version than
  // the one this package installs (both satisfy ^5.4.1 in pnpm's store).
  // Runtime behaviour is identical — the type mismatch is purely a store
  // artefact. Remove the cast once the monorepo pins one ioredis version.
  const q = new Queue(name, { connection: queueRedis as never });
  queues.set(name, q);
  return q;
}

// ---------- Inline-mode handler registry ----------
//
// When Redis isn't available we still need enqueue() to work. Callers register
// their handler with `getWorker(name, fn)`; enqueue calls it via setImmediate.

type InlineHandler = (job: { name: string; data: unknown }) => Promise<unknown>;
const inlineHandlers = new Map<string, InlineHandler>();

// ---------- Public API ----------

export interface EnqueueOptions {
  /** Job name (defaults to "default"). Useful for filtering + BullMQ UIs. */
  jobName?: string;
  /** Attempts before moving to failed. Defaults to 3. */
  attempts?: number;
  /** Backoff: exponential, starting at N ms. Defaults to 5000. */
  backoffMs?: number;
  /** Delay before first attempt, ms. */
  delayMs?: number;
  /** Idempotency key — BullMQ dedupes concurrent adds with the same jobId. */
  jobId?: string;
}

/**
 * Enqueue a job. In real mode returns the BullMQ job id; in inline mode
 * returns a synthetic id and fires the handler on the next tick.
 */
export async function enqueue<T>(
  queueName: string,
  data: T,
  opts: EnqueueOptions = {},
): Promise<string> {
  const jobName = opts.jobName ?? "default";
  const q = getQueue(queueName);
  if (q) {
    const jobsOptions: JobsOptions = {
      attempts: opts.attempts ?? 3,
      backoff: { type: "exponential", delay: opts.backoffMs ?? 5000 },
      removeOnComplete: { age: 3600, count: 500 },
      removeOnFail: { age: 24 * 3600 },
      delay: opts.delayMs,
      jobId: opts.jobId,
    };
    const job = await q.add(jobName, data, jobsOptions);
    return job.id ?? `${queueName}:${Date.now()}`;
  }
  // Inline mode. Fire on next tick so callers can return a response first.
  const handler = inlineHandlers.get(queueName);
  const syntheticId = `inline:${queueName}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  if (!handler) {
    // No handler registered yet (worker not started). Silently drop —
    // this is only reachable in test mode where a test forgot to boot
    // the worker. Log so it's discoverable.
    // eslint-disable-next-line no-console
    console.warn(`[queue] no inline handler for '${queueName}' — job dropped`);
    return syntheticId;
  }
  setImmediate(() => {
    void handler({ name: jobName, data }).catch((e) => {
      // eslint-disable-next-line no-console
      console.error(`[queue:inline:${queueName}] handler error:`, e);
    });
  });
  return syntheticId;
}

/**
 * Start a worker for `queueName`. In real mode returns a BullMQ Worker; in
 * inline mode registers the handler in the in-memory map + returns null.
 */
export function startWorker<T>(
  queueName: string,
  handler: (job: Job<T> | { name: string; data: T }) => Promise<unknown>,
  opts: Partial<WorkerOptions> = {},
): Worker | null {
  if (!isQueueReal()) {
    inlineHandlers.set(
      queueName,
      handler as unknown as InlineHandler,
    );
    return null;
  }
  const worker = new Worker(queueName, handler as (job: Job<T>) => Promise<unknown>, {
    // Same cast reason as Queue construction above — see note.
    connection: getRedis() as never,
    concurrency: 5,
    ...opts,
  });
  worker.on("failed", (job, err) => {
    // eslint-disable-next-line no-console
    console.error(
      `[queue:${queueName}] job ${job?.id ?? "?"} failed:`,
      err.message,
    );
  });
  return worker;
}

// ---------- Diagnostics ----------

export interface QueueStats {
  name: string;
  mode: "real" | "inline";
  counts?: {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  };
}

/** Snapshot for the /queues diagnostics endpoint. */
export async function getQueueStats(names: string[]): Promise<QueueStats[]> {
  const out: QueueStats[] = [];
  for (const name of names) {
    const q = getQueue(name);
    if (!q) {
      out.push({ name, mode: "inline" });
      continue;
    }
    const counts = await q.getJobCounts(
      "waiting",
      "active",
      "completed",
      "failed",
      "delayed",
    );
    out.push({
      name,
      mode: "real",
      counts: {
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        completed: counts.completed ?? 0,
        failed: counts.failed ?? 0,
        delayed: counts.delayed ?? 0,
      },
    });
  }
  return out;
}

// ---------- Shutdown ----------

export async function closeQueues(): Promise<void> {
  for (const q of queues.values()) {
    await q.close();
  }
  queues.clear();
  if (queueRedis) {
    await queueRedis.quit();
    queueRedis = null;
  }
  if (workerRedis) {
    await workerRedis.quit();
    workerRedis = null;
  }
  redisAttempted = false;
}

// ---------- Standard queue names + payload shapes ----------
//
// Central registry so we don't get typos scattered across services. Payload
// interfaces live here too, so the enqueuer (accounting-service) and the
// worker (scheduler) share the same contract without either depending on
// the other.

export const QUEUE_IMPORTS = "imports";
export const QUEUE_BACKUPS = "backups";
export const QUEUE_EMAIL = "email";

export const ALL_QUEUE_NAMES = [QUEUE_IMPORTS, QUEUE_BACKUPS, QUEUE_EMAIL] as const;

export interface ImportJobPayload {
  importJobId: string;
  tenantId: string;
  doctype: string;
  csv?: string;
  xlsxBase64?: string;
  mode: "create" | "upsert" | "update";
  keyField?: string | null;
  dryRun: boolean;
  columnMap?: Record<string, string>;
}

export { Queue, Worker, Job, QueueEvents };

// Marketing P1 — per-tenant send-rate limiter (see marketing-throttle.ts).
export { takeToken, peekBucket } from "./marketing-throttle";

// ── scheduleRepeatable ────────────────────────────────────────────────
//
// Replaces the ad-hoc `setInterval(job, ms)` pattern the scheduler uses
// for background ticks. Two modes:
//
//   * Real mode (REDIS_URL set): registers a BullMQ Worker + Repeatable
//     Job. Persistent — the tick survives a scheduler restart. Distributed —
//     if two scheduler instances run simultaneously, BullMQ's job uniqueness
//     guarantees only one fires per interval. Failed handlers retry with
//     exponential backoff. Trace context propagates via traceparent so OTel
//     sees the full parent → tick → downstream chain.
//
//   * Inline mode (no REDIS_URL): keeps the current setInterval semantics
//     so `pnpm dev` works without booting Redis. `stop()` cleans up.
//
// Returns a `stop()` handle the caller can invoke on shutdown; graceful
// shutdown wires this up automatically in service-auth's installGracefulShutdown.
export interface RepeatableHandle {
  name: string;
  stop: () => Promise<void>;
}

// Separate from the module-level `queues` Map above (which is keyed by name,
// used by getQueue()). This list holds only queues created by
// scheduleRepeatable() so stopAllRepeatables() can drain them.
const repeatableWorkers: Worker[] = [];
const repeatableQueues: Queue[] = [];
const intervals: NodeJS.Timeout[] = [];

export function scheduleRepeatable(
  name: string,
  handler: () => Promise<void> | void,
  intervalMs: number,
  opts: { runImmediately?: boolean } = {},
): RepeatableHandle {
  const redis = getRedis();

  // ── Inline (dev) mode ───────────────────────────────────────────
  if (!redis) {
    if (opts.runImmediately !== false) void handler();
    const h = setInterval(() => void handler(), intervalMs);
    intervals.push(h);
    return {
      name,
      async stop() {
        clearInterval(h);
      },
    };
  }

  // ── Real (BullMQ) mode ──────────────────────────────────────────
  const queueName = `sched.${name}`;
  // pnpm resolves ioredis to two versions (bullmq peers 5.10.x, we ship
  // 5.11.x). The runtime shapes are compatible; TS refuses because the
  // Connector class identity differs between versions. `as never` bypasses
  // the identity check without weakening the rest of the API.
  const queue = new Queue(queueName, { connection: redis as never });
  repeatableQueues.push(queue);

  // Repeatable job — BullMQ deduplicates by name so two scheduler
  // instances won't fire the same tick twice.
  void queue.add(
    name,
    {},
    {
      repeat: { every: intervalMs },
      // Idempotent job id lets us re-add on boot without dupes
      jobId: `repeat:${name}`,
      removeOnComplete: 100,
      removeOnFail: 500,
      attempts: 3,
      backoff: { type: "exponential", delay: 15_000 },
    },
  );

  // Optionally kick off once immediately so a freshly-booted scheduler
  // doesn't wait a full interval before the first tick.
  if (opts.runImmediately !== false) {
    void queue.add(name, {}, { removeOnComplete: true, removeOnFail: true });
  }

  const worker = new Worker(
    queueName,
    async () => {
      await handler();
    },
    {
      connection: redis as never, // see note on queue construction above
      concurrency: 1,
      autorun: true,
    },
  );
  repeatableWorkers.push(worker);

  return {
    name,
    async stop() {
      try {
        await worker.close();
      } catch {
        /* best effort */
      }
      try {
        await queue.close();
      } catch {
        /* best effort */
      }
    },
  };
}

// Stop every scheduleRepeatable() call in one go — installGracefulShutdown
// wires this to SIGTERM/SIGINT.
export async function stopAllRepeatables(): Promise<void> {
  for (const h of intervals) clearInterval(h);
  intervals.length = 0;
  await Promise.all([
    ...repeatableWorkers.map((w) => w.close().catch(() => undefined)),
    ...repeatableQueues.map((q) => q.close().catch(() => undefined)),
  ]);
  repeatableWorkers.length = 0;
  repeatableQueues.length = 0;
}
