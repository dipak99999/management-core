import type { NextFunction, Request, Response } from "express";
import cors from "cors";

// Shared security middleware for all backend services. Sets baseline response
// headers (nosniff, frame-deny, referrer-policy, CSP) and configures CORS
// against a whitelist.
//
// Origin whitelist:
//   ALLOWED_ORIGINS env is a comma-separated list. Empty = fall back to a
//   built-in dev whitelist (localhost:3100–3107 shell + module apps + portal).
//   In production ALLOWED_ORIGINS MUST be set explicitly; we do NOT silently
//   fall back to "*" in production because that neuters CORS.
//
// HSTS is only emitted when NODE_ENV=production so dev browsers don't get a
// permanent HTTPS-upgrade lock on localhost.

const DEV_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3002",
  "http://localhost:3003",
  "http://localhost:3004",
  "http://localhost:3005",
  "http://localhost:3006",
  "http://localhost:3007",
  "http://localhost:3100",
  "http://localhost:3101",
  "http://localhost:3102",
  "http://localhost:3103",
  "http://localhost:3104",
  "http://localhost:3105",
  "http://localhost:3106",
  "http://localhost:3107",
  // Custom shell port overrides — kept in dev whitelist so the login page +
  // client API fetches work when the shell is moved off 3000.
  "http://localhost:6256",
  "http://localhost:4556",
];

function parseOrigins(): string[] {
  const raw = process.env.ALLOWED_ORIGINS;
  if (raw && raw.trim().length > 0) {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "ALLOWED_ORIGINS env var must be set in production (comma-separated list). " +
        'Never use "*" — CORS with wildcard + credentials is a security hole.',
    );
  }
  return DEV_ORIGINS;
}

const ALLOWED_ORIGINS = parseOrigins();
const ALLOWED_SET = new Set(ALLOWED_ORIGINS);

// CORS middleware. Uses a function-based origin check so we can log denials +
// keep the wildcard-in-prod escape hatch off. Server-to-server calls with no
// Origin header (curl, health checks, internal services) are permitted.
//
// buildCorsMiddleware() lets services extend the base policy (e.g. exposing
// extra response headers) without duplicating the origin whitelist — used by
// mcp-server which must expose `mcp-session-id` to browser SSE clients.
export function buildCorsMiddleware(
  overrides: { exposedHeaders?: string[] } = {},
) {
  return cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (ALLOWED_SET.has(origin)) return cb(null, true);
      cb(new Error(`Origin ${origin} not allowed by CORS`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["authorization", "content-type", "x-request-id"],
    ...(overrides.exposedHeaders ? { exposedHeaders: overrides.exposedHeaders } : {}),
  });
}

export const corsMiddleware = buildCorsMiddleware();

// Baseline security headers. Applied to every response.
//   Content-Security-Policy — narrow default. API responses are JSON so a
//     restrictive CSP is safe; static asset serving happens in Next apps
//     which set their own CSP.
//   X-Content-Type-Options: nosniff — mitigates MIME confusion (critical
//     given the attachment-download endpoint serves user-uploaded bytes).
//   X-Frame-Options: DENY — no framing at all on API endpoints.
//   Referrer-Policy — don't leak URLs to third parties.
//   Strict-Transport-Security — only in prod (localhost dev would break).
export function securityHeaders(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; frame-ancestors 'none'",
  );
  // Explicitly disable the X-Powered-By leak (Express sets it by default).
  res.removeHeader("X-Powered-By");
  if (process.env.NODE_ENV === "production") {
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
  }
  next();
}
