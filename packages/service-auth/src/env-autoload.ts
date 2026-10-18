// Side-effect env-file autoloader. Imported once by service-auth's
// index.ts so every service picks up the workspace's `.env` before
// `validateEnv()` runs. Production sets env directly via
// docker-compose / systemd / k8s manifests — this is a dev-mode
// convenience with zero footprint in prod (skips the walk if
// LUMAARA_SKIP_DOTENV=1 or NODE_ENV=production).
//
// Search order (first hit wins):
//   1. process.env.LUMAARA_ENV_FILE — explicit override
//   2. `.env` in cwd, walking up 6 levels — finds monorepo root
//
// Zero deps: minimal INI-style parser (K=V, ignore blanks + #).

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

function findEnvFile(): string | null {
  const explicit = process.env.LUMAARA_ENV_FILE;
  if (explicit && existsSync(explicit)) return explicit;
  let dir = resolve(process.cwd());
  for (let i = 0; i < 6; i++) {
    const p = join(dir, ".env");
    if (existsSync(p)) return p;
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function parse(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of src.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (k) out[k] = v;
  }
  return out;
}

export function autoloadEnvFile(): { loaded: string | null; count: number } {
  if (process.env.LUMAARA_SKIP_DOTENV === "1") return { loaded: null, count: 0 };
  if (process.env.NODE_ENV === "production" && !process.env.LUMAARA_ENV_FILE) {
    // In prod, config comes from the orchestrator, not files.
    return { loaded: null, count: 0 };
  }
  const path = findEnvFile();
  if (!path) return { loaded: null, count: 0 };
  const src = readFileSync(path, "utf8");
  const parsed = parse(src);
  let count = 0;
  for (const [k, v] of Object.entries(parsed)) {
    // Never clobber a value already set by the shell / orchestrator —
    // process.env wins over .env, per 12-factor.
    if (process.env[k] == null || process.env[k] === "") {
      process.env[k] = v;
      count++;
    }
  }
  return { loaded: path, count };
}

// Run once on import.
autoloadEnvFile();
