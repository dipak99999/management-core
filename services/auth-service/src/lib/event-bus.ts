import { EventEmitter } from "node:events";
import IORedis, { type Redis } from "ioredis";

/**
 * Tenant-scoped pub/sub for SSE fan-out.
 *
 * Modes:
 *   - **Redis mode** — REDIS_URL is set. publish() → PUBLISH on a redis
 *     channel; subscribe() keeps one shared SUBSCRIBE connection and
 *     tracks per-subscription handlers in-process. Multi-replica safe.
 *   - **Inline mode** — REDIS_URL unset. Falls back to a local
 *     EventEmitter so dev + tests work without Redis. Single-process only.
 *
 * Keys are `lumaara:bus:<tenantId>:<channel>` so multi-tenant isolation
 * is enforced at the redis key level, not just application code.
 */

const KEY_PREFIX = "lumaara:bus";
const key = (tenantId: string, channel: string) =>
  `${KEY_PREFIX}:${tenantId}:${channel}`;

type Handler = (channel: string, data: unknown) => void;

class RedisEventBus {
  private pub: Redis;
  private sub: Redis;
  // channel key -> set of per-subscription handlers
  private handlers = new Map<string, Set<Handler>>();

  constructor(url: string) {
    this.pub = new IORedis(url, { lazyConnect: false, maxRetriesPerRequest: 3 });
    this.sub = new IORedis(url, { lazyConnect: false, maxRetriesPerRequest: null });
    this.pub.on("error", (e) => console.error("[event-bus:pub]", e.message));
    this.sub.on("error", (e) => console.error("[event-bus:sub]", e.message));
    this.sub.on("message", (ch, raw) => {
      const set = this.handlers.get(ch);
      if (!set || set.size === 0) return;
      let data: unknown;
      try { data = JSON.parse(raw); } catch { data = raw; }
      // Extract the application channel segment: ch = "lumaara:bus:<tid>:<app>"
      // → we want the trailing `<app>` to pass through to subscribers.
      const parts = ch.split(":");
      const appChannel = parts.slice(3).join(":");
      for (const h of set) h(appChannel, data);
    });
  }

  publish(tenantId: string, channel: string, data: unknown): void {
    void this.pub.publish(key(tenantId, channel), JSON.stringify(data));
  }

  subscribe(tenantId: string, channels: string[], cb: Handler): () => void {
    const keys = channels.map((c) => key(tenantId, c));
    for (const k of keys) {
      let set = this.handlers.get(k);
      if (!set) {
        set = new Set();
        this.handlers.set(k, set);
        void this.sub.subscribe(k);
      }
      set.add(cb);
    }
    return () => {
      for (const k of keys) {
        const set = this.handlers.get(k);
        if (!set) continue;
        set.delete(cb);
        if (set.size === 0) {
          this.handlers.delete(k);
          void this.sub.unsubscribe(k);
        }
      }
    };
  }

  async close(): Promise<void> {
    await Promise.allSettled([this.pub.quit(), this.sub.quit()]);
  }
}

class InlineEventBus {
  private ee = new EventEmitter();
  constructor() {
    this.ee.setMaxListeners(10_000);
  }
  publish(tenantId: string, channel: string, data: unknown): void {
    this.ee.emit(key(tenantId, channel), data);
  }
  subscribe(tenantId: string, channels: string[], cb: Handler): () => void {
    const bindings: Array<{ k: string; fn: (data: unknown) => void }> = [];
    for (const ch of channels) {
      const k = key(tenantId, ch);
      const fn = (data: unknown) => cb(ch, data);
      this.ee.on(k, fn);
      bindings.push({ k, fn });
    }
    return () => {
      for (const b of bindings) this.ee.off(b.k, b.fn);
    };
  }
  async close(): Promise<void> { /* no-op */ }
}

function build(): RedisEventBus | InlineEventBus {
  const url = process.env.REDIS_URL;
  if (!url) return new InlineEventBus();
  try {
    return new RedisEventBus(url);
  } catch (e) {
    console.error("[event-bus] failed to init redis, falling back to in-process:", e);
    return new InlineEventBus();
  }
}

export const eventBus = build();
