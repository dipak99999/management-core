// Structured JSON logger. One log line per event; every line has the same
// baseline keys (level, time, service) plus whatever context the caller
// passes. This is the single sink for ad-hoc application logs (route
// handlers, adapters, background jobs) — anywhere `console.log/warn/error`
// would otherwise leak an unstructured string.
//
// Design notes:
//   - Writes to stdout for info/debug/warn, stderr for error/fatal. Standard
//     12-factor: the platform (docker, systemd, pm2) captures both streams.
//   - Never throws. A logger that crashes the request is worse than no log.
//   - Serializes Error instances (message + stack) so `log.error("failed", { err })`
//     produces a useful stack, not `"err":"[object Object]"`.
//   - LOG_LEVEL env filters below a threshold. Default "info" in prod,
//     "debug" in dev.

export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";
const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 50,
};

function activeLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL ?? "").toLowerCase() as LogLevel;
  if (raw in LEVEL_RANK) return raw;
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

// Keys that trigger redaction. Match is case-insensitive and matches on
// `key.includes(pattern)` so `clientSecretHash` and `apiKey` are caught
// without having to enumerate every variant. Keep the list conservative —
// over-redacting hides debugging context, under-redacting ships secrets
// to log sinks.
const REDACT_KEY_PATTERNS = [
  "password",
  "passwordhash",
  "secret",
  "token", // catches jwt / idToken / refreshToken / apiToken / clientSecretHash via "secret"
  "apikey",
  "api_key",
  "authorization",
  "cookie",
  "setcookie",
  "set-cookie",
  "privatekey",
  "private_key",
];

const REDACTED = "[REDACTED]";
const MAX_DEPTH = 6;

function shouldRedact(key: string): boolean {
  const k = key.toLowerCase();
  return REDACT_KEY_PATTERNS.some((p) => k.includes(p));
}

function redactValue(v: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return v;
  if (v === null || v === undefined) return v;
  if (Array.isArray(v)) return v.map((e) => redactValue(e, depth + 1));
  if (typeof v === "object") return redactObject(v as Record<string, unknown>, depth + 1);
  return v;
}

function redactObject(obj: Record<string, unknown>, depth: number): Record<string, unknown> {
  if (depth > MAX_DEPTH) return obj;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (shouldRedact(k)) {
      out[k] = REDACTED;
      continue;
    }
    out[k] = redactValue(v, depth);
  }
  return out;
}

function serializeContext(ctx: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!ctx) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ctx)) {
    // Redact any top-level key whose name signals a secret, regardless
    // of value shape. Prevents `log.info("x", { password: "hunter2" })`
    // from leaking even when the value is a plain string.
    if (shouldRedact(k)) {
      out[k] = REDACTED;
      continue;
    }
    if (v instanceof Error) {
      out[k] = { message: v.message, stack: v.stack, name: v.name };
    } else if (typeof v === "bigint") {
      out[k] = v.toString();
    } else {
      out[k] = redactValue(v, 0);
    }
  }
  return out;
}

export interface Logger {
  debug(msg: string, ctx?: Record<string, unknown>): void;
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
  fatal(msg: string, ctx?: Record<string, unknown>): void;
  // Return a child logger with pinned context (e.g. per-request tenant/user).
  child(bindings: Record<string, unknown>): Logger;
}

function makeLogger(baseContext: Record<string, unknown>): Logger {
  const threshold = LEVEL_RANK[activeLevel()];

  function emit(level: LogLevel, msg: string, ctx?: Record<string, unknown>): void {
    if (LEVEL_RANK[level] < threshold) return;
    const payload = {
      level,
      time: new Date().toISOString(),
      msg,
      ...baseContext,
      ...serializeContext(ctx),
    };
    const line = JSON.stringify(payload);
    // Swallow any I/O failure — logging must never throw.
    try {
      if (level === "error" || level === "fatal") {
        process.stderr.write(line + "\n");
      } else {
        process.stdout.write(line + "\n");
      }
    } catch {
      // ignore
    }
  }

  return {
    debug: (m, c) => emit("debug", m, c),
    info: (m, c) => emit("info", m, c),
    warn: (m, c) => emit("warn", m, c),
    error: (m, c) => emit("error", m, c),
    fatal: (m, c) => emit("fatal", m, c),
    child: (bindings) => makeLogger({ ...baseContext, ...bindings }),
  };
}

// Root logger — services + adapters call `getLogger("service-name")` at
// module load to get an instance bound to their service field.
const rootByService = new Map<string, Logger>();
export function getLogger(service: string): Logger {
  const existing = rootByService.get(service);
  if (existing) return existing;
  const l = makeLogger({ service });
  rootByService.set(service, l);
  return l;
}
