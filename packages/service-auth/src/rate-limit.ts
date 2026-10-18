import rateLimit from "express-rate-limit";
import { redisStore } from "./rate-limit-redis-store";

// Shared rate-limit presets so every service throttles the same way.
//
// RATE_LIMIT_DISABLED=1 short-circuits every limiter (test/CI only). Never
// set in production — it removes the throttle. Kept in sync with the
// per-service limiters in auth-service.
//
// Store: Redis-backed when REDIS_URL is set so counters are shared across
// replicas (a 600/min cap stays 600/min regardless of how many containers
// serve the traffic). Falls back to in-memory in dev when REDIS_URL is
// unset. See rate-limit-redis-store.ts for the schema.
const skipLimit = () => process.env.RATE_LIMIT_DISABLED === "1";

// PDF generation is CPU-heavy (~50-200ms per doc with @react-pdf/renderer).
// Cap per authenticated user so one client can't tie up the process.
export const pdfLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 min
  limit: 30, // 30 PDFs / user / minute
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => req.auth?.userId ?? req.ip ?? "-",
  message: { error: "PDF rate limit exceeded — retry in a minute" },
  skip: skipLimit,
  store: redisStore("rl:pdf"),
});

// Report Builder runs Prisma against whitelisted doctypes but a user could
// still spam expensive queries. Softer cap than PDF.
export const reportLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => req.auth?.userId ?? req.ip ?? "-",
  message: { error: "Report rate limit exceeded — retry in a minute" },
  skip: skipLimit,
  store: redisStore("rl:report"),
});

// Blanket per-user cap that every non-auth service mounts as its first
// middleware. Generous default (600/min ≈ 10 req/s per user) so normal
// usage never trips it — but stops a compromised token or runaway
// integration from flooding the API. Tune with API_LIMIT_PER_MIN env
// per-service if a service is intentionally high-throughput.
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.API_LIMIT_PER_MIN) || 600,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => req.auth?.userId ?? req.ip ?? "-",
  message: { error: "API rate limit exceeded — try again shortly" },
  skip: skipLimit,
  store: redisStore("rl:api"),
});

// Public/unauthenticated endpoints (webhooks, incoming email hooks, health
// probes) key on IP alone. Tight cap because there's no user identity to
// fall back on for accountability.
export const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.PUBLIC_LIMIT_PER_MIN) || 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => req.ip ?? "-",
  message: { error: "Rate limit exceeded — try again shortly" },
  skip: skipLimit,
  store: redisStore("rl:public"),
});

// AI / LLM endpoints: much tighter than the blanket apiLimiter because each
// call can cost real money (one bad client loop against ai-chat can run up
// a four-figure LLM bill in minutes). Default 30/min per user; raise via
// AI_LIMIT_PER_MIN only after reviewing provider spend caps. Separate Redis
// bucket so AI traffic can't eat the api budget.
export const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.AI_LIMIT_PER_MIN) || 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => req.auth?.userId ?? req.ip ?? "-",
  message: { error: "AI rate limit exceeded — retry in a minute" },
  skip: skipLimit,
  store: redisStore("rl:ai"),
});

// Per-TENANT per-DAY AI cap. The user-level `aiLimiter` above caps bursts
// but a tenant with N users can still spend N × AI_LIMIT_PER_MIN per
// minute — easily four figures of LLM cost per day. This limiter counts
// every AI call against the tenant's 24h budget regardless of which user
// made it. Default 1000 calls / tenant / day; override per deployment
// via AI_TENANT_DAILY_LIMIT once you've measured real spend.
//
// Mount order: `aiLimiter` first (fast rejection on per-user bursts),
// then this one. Both share the per-route /ai prefix.
//
// Non-Redis fallback: express-rate-limit's default MemoryStore resets on
// process restart, so without REDIS_URL this limit is effectively
// per-container-per-day. Prod MUST set REDIS_URL (also required for the
// existing per-user limiter to be meaningful across replicas).
export const aiTenantDailyLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24h
  limit: Number(process.env.AI_TENANT_DAILY_LIMIT) || 1000,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => req.auth?.tenantId ?? req.ip ?? "-",
  message: {
    error: "AI daily spend budget exceeded for this tenant — contact support to raise the cap",
    code: "AI_TENANT_DAILY_LIMIT",
  },
  skip: skipLimit,
  store: redisStore("rl:ai-tenant-daily"),
});
