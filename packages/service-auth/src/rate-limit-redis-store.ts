// Redis-backed store for express-rate-limit.
//
// Default express-rate-limit uses an in-memory Map keyed by IP/user. That's
// correct for a single process, but every replica keeps its own counter so
// a 60/min cap becomes 60/min × N replicas = effectively unenforced under
// load. This store uses INCR + EXPIRE on a shared Redis so counters are
// shared across every process in the deployment.
//
// Falls back to express-rate-limit's default MemoryStore when REDIS_URL is
// unset (dev / single-process scenarios), so tests + local dev don't
// require a Redis.
//
// Key schema:   rl:<service>:<name>:<key>:<windowStart>
// windowStart is the floor of now / windowMs — same request within the
// same window hits the same key. Keys auto-expire via EXPIRE so there's
// no cleanup job.

import type { Store, IncrementResponse, Options } from "express-rate-limit";
import { getRedis } from "@lumaara/queue";

export class RedisRateLimitStore implements Store {
  public localKeys = true; // express-rate-limit's optional flag
  prefix: string;
  private windowMs = 60_000;

  constructor(opts: { prefix?: string } = {}) {
    this.prefix = opts.prefix ?? "rl";
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  private keyFor(k: string): string {
    const windowStart = Math.floor(Date.now() / this.windowMs);
    return `${this.prefix}:${k}:${windowStart}`;
  }

  async increment(key: string): Promise<IncrementResponse> {
    const r = getRedis();
    if (!r) {
      // Degenerate case — queue couldn't connect. Return a safe no-op so
      // the limiter never crashes a request. In prod with REDIS_URL set
      // and ioredis reconnecting, this is extremely rare.
      return {
        totalHits: 1,
        resetTime: new Date(Date.now() + this.windowMs),
      };
    }
    const k = this.keyFor(key);
    const multi = r.multi();
    multi.incr(k);
    multi.pexpire(k, this.windowMs);
    const results = (await multi.exec()) as Array<[Error | null, unknown]> | null;
    const totalHits = Number((results?.[0]?.[1] as number) ?? 1);
    // resetTime = window boundary — not perfectly accurate (slight drift
    // vs the real EXPIRE), but close enough for Retry-After headers.
    const windowBoundary =
      (Math.floor(Date.now() / this.windowMs) + 1) * this.windowMs;
    return { totalHits, resetTime: new Date(windowBoundary) };
  }

  async decrement(key: string): Promise<void> {
    const r = getRedis();
    if (!r) return;
    await r.decr(this.keyFor(key)).catch(() => void 0);
  }

  async resetKey(key: string): Promise<void> {
    const r = getRedis();
    if (!r) return;
    await r.del(this.keyFor(key)).catch(() => void 0);
  }
}

/**
 * Factory — returns a Redis-backed store when REDIS_URL is set, else
 * undefined so express-rate-limit falls back to its default MemoryStore.
 * Pass a stable `prefix` per limiter so counters don't collide across
 * services (e.g. `rl:auth:login`, `rl:accounting:ai-chat`).
 */
export function redisStore(prefix: string): Store | undefined {
  if (!process.env.REDIS_URL) return undefined;
  return new RedisRateLimitStore({ prefix });
}
