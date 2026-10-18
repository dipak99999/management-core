// Boot-time env-var validator. Every service calls
// `validateEnv({...})` at the top of index.ts — any missing required
// var throws immediately with a clear message.
//
// Pattern:
//   validateEnv({
//     required: ["DATABASE_URL", "JWT_SECRET", "MASTER_SECRET_KEY"],
//     optional: {
//       PORT: "4001",
//       OTEL_EXPORTER_OTLP_ENDPOINT: "",
//     },
//   });
//
// Also enforces a `>=32` char minimum on secret-looking keys (any key
// ending in _SECRET / _KEY / _TOKEN). Prevents deploying with the dev
// defaults from docker-compose.yml ("change-me-in-production-please").

export interface EnvSpec {
  required: string[];
  optional?: Record<string, string>; // key → default (applied to process.env if unset)
  secretMinLength?: number;          // default 32
}

const DEV_MARKERS = [
  "change-me",
  "changeme",
  "please-change",
  "insecure",
  "dev-only",
  "test-only",
  "example",
];

export function validateEnv(spec: EnvSpec): void {
  const missing: string[] = [];
  const weakSecrets: string[] = [];
  const secretMinLen = spec.secretMinLength ?? 32;

  for (const key of spec.required) {
    const v = process.env[key];
    if (v == null || v === "") {
      missing.push(key);
      continue;
    }
    if (/_SECRET$|_KEY$|_TOKEN$|_PASSWORD$/.test(key)) {
      if (v.length < secretMinLen) {
        weakSecrets.push(`${key} (length ${v.length} < ${secretMinLen})`);
      } else {
        const lower = v.toLowerCase();
        if (DEV_MARKERS.some((m) => lower.includes(m))) {
          weakSecrets.push(`${key} looks like a dev placeholder`);
        }
      }
    }
  }

  for (const [key, def] of Object.entries(spec.optional ?? {})) {
    if (process.env[key] == null || process.env[key] === "") {
      process.env[key] = def;
    }
  }

  const problems: string[] = [];
  if (missing.length > 0) {
    problems.push(`Missing required env vars: ${missing.join(", ")}`);
  }
  if (weakSecrets.length > 0 && process.env.NODE_ENV === "production") {
    problems.push(`Weak / placeholder secrets in production: ${weakSecrets.join("; ")}`);
  }
  if (problems.length > 0) {
    const guidance =
      weakSecrets.length > 0 && process.env.NODE_ENV === "production"
        ? "\n\nGenerate real secrets with:\n  bash scripts/generate-prod-secrets.sh > .env.prod && chmod 600 .env.prod\n\n" +
          "Each listed value is auto-generated via `openssl rand -hex 32`.\n" +
          "LOSING MASTER_SECRET_KEY bricks all encrypted rows — back it up offsite."
        : "";
    throw new Error(
      `Environment validation failed:\n  - ${problems.join("\n  - ")}\n\n` +
        `Refer to .env.example or PRODUCTION.md for the required set.${guidance}`,
    );
  }
}
