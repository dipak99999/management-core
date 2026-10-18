// Centralized secret access with startup-time validation.
//
// The old pattern `process.env.JWT_SECRET ?? "dev-secret"` scattered across
// every service silently degraded to the string "dev-secret" if the env was
// unset — trivially forgeable tokens in production. This module makes the
// contract explicit:
//   - In production (NODE_ENV=production), missing/short/known-dev secrets
//     throw at import time so the service refuses to start.
//   - In dev, a warning is emitted and a randomly-seeded fallback is used
//     (regenerated per process, so tokens don't persist across restarts).
//
// Consumers import the frozen constants; there is no runtime env lookup.

import { randomBytes } from "node:crypto";

const IS_PROD = process.env.NODE_ENV === "production";
const KNOWN_DEV_SECRETS = new Set(["dev-secret", "changeme", "change-me", ""]);
const MIN_LEN = 32;

function loadSecret(varName: string, opts: { required?: boolean } = {}): string {
  const raw = process.env[varName];
  if (raw && raw.length >= MIN_LEN && !KNOWN_DEV_SECRETS.has(raw)) return raw;

  if (IS_PROD) {
    if (opts.required !== false) {
      throw new Error(
        `Refusing to start: ${varName} must be set to a random string of at ` +
          `least ${MIN_LEN} chars in production (got ${raw ? "a weak/known value" : "nothing"}). ` +
          "Generate one via `openssl rand -hex 32`.",
      );
    }
  }

  // Dev: emit a loud warning + return a process-scoped random.
  const dev = raw || randomBytes(32).toString("hex");
  if (raw && (raw.length < MIN_LEN || KNOWN_DEV_SECRETS.has(raw))) {
    // eslint-disable-next-line no-console
    console.warn(
      `[secrets] ${varName} looks like a dev/weak value — usable for local dev only.`,
    );
  } else if (!raw) {
    // eslint-disable-next-line no-console
    console.warn(
      `[secrets] ${varName} is unset — using ephemeral random. Tokens will be ` +
        "invalidated on process restart. Set the env var to persist sessions.",
    );
  }
  return dev;
}

export const JWT_SECRET = loadSecret("JWT_SECRET");
export const PORTAL_JWT_SECRET = loadSecret("PORTAL_JWT_SECRET");
export const UNSUBSCRIBE_SECRET = loadSecret("UNSUBSCRIBE_SECRET");
