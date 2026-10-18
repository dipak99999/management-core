#!/usr/bin/env tsx
/**
 * Full-database restore wrapper around `pg_restore`.
 *
 * Requires `--yes` to actually execute — restore is destructive
 * (`--clean --if-exists` drops existing objects before recreating). Print a
 * dry-run summary otherwise.
 *
 * Usage:
 *   pnpm --filter @lumaara/db restore -- ./backups/lumaara_2026-08-16.dump
 *   pnpm --filter @lumaara/db restore -- ./backups/lumaara_2026-08-16.dump --yes
 */

import { execFile } from "node:child_process";
import { statSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

function parseDatabaseUrl(url: string) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: u.port || "5432",
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.slice(1),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  const yes = args.includes("--yes");

  if (!file) {
    console.error("Usage: restore <dumpfile> [--yes]");
    process.exit(1);
  }

  const path = resolve(file);
  try {
    const stat = statSync(path);
    if (!stat.isFile()) throw new Error("not a file");
  } catch {
    console.error(`Dump file not found: ${path}`);
    process.exit(1);
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }
  const cfg = parseDatabaseUrl(url);

  if (!yes) {
    console.log(`[restore] DRY RUN — would restore ${path}`);
    console.log(`[restore]   into ${cfg.database}@${cfg.host}:${cfg.port}`);
    console.log(`[restore]   this DROPS existing objects.`);
    console.log(`[restore]   pass --yes to execute.`);
    return;
  }

  console.log(`[restore] restoring ${path} → ${cfg.database}@${cfg.host}`);
  try {
    await execFileP(
      "pg_restore",
      [
        "--host",
        cfg.host,
        "--port",
        cfg.port,
        "--username",
        cfg.user,
        "--dbname",
        cfg.database,
        "--clean",
        "--if-exists",
        "--no-owner",
        "--no-acl",
        path,
      ],
      { env: { ...process.env, PGPASSWORD: cfg.password } },
    );
    console.log("[restore] done");
  } catch (e) {
    // pg_restore commonly warns (non-fatal) — surface stderr but don't treat
    // as failure unless exit code says so.
    if (e && typeof e === "object" && "code" in e && (e as { code: number }).code === 0) {
      console.log("[restore] done (with warnings)");
      return;
    }
    console.error("[restore] pg_restore failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  }
}

main();
