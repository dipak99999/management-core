#!/usr/bin/env tsx
/**
 * Full-database backup wrapper around `pg_dump`.
 *
 * Reads DATABASE_URL, parses out {host, port, db, user, pass}, and shells out.
 * Writes to ./backups/lumaara_<UTC-timestamp>.dump in Postgres custom format
 * (compressed, restorable via `pg_restore`). Prints the path on success.
 *
 * Usage:
 *   pnpm --filter @lumaara/db backup
 *   pnpm --filter @lumaara/db backup -- --out ./elsewhere
 */

import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

function parseDatabaseUrl(url: string) {
  // postgresql://user:pass@host:5432/dbname?schema=public
  const u = new URL(url);
  return {
    host: u.hostname,
    port: u.port || "5432",
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.slice(1),
  };
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, -5);
}

async function main() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf("--out");
  const outDir = resolve(outIdx >= 0 ? args[outIdx + 1] : "./backups");
  mkdirSync(outDir, { recursive: true });

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }
  const cfg = parseDatabaseUrl(url);
  const outPath = resolve(outDir, `lumaara_${timestamp()}.dump`);

  console.log(`[backup] ${cfg.database}@${cfg.host}:${cfg.port} → ${outPath}`);
  try {
    await execFileP(
      "pg_dump",
      [
        "--host",
        cfg.host,
        "--port",
        cfg.port,
        "--username",
        cfg.user,
        "--dbname",
        cfg.database,
        "--format",
        "custom",
        "--compress",
        "9",
        "--no-owner",
        "--no-acl",
        "--file",
        outPath,
      ],
      { env: { ...process.env, PGPASSWORD: cfg.password } },
    );
    console.log(`[backup] done → ${outPath}`);
  } catch (e) {
    console.error("[backup] pg_dump failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  }
}

main();
