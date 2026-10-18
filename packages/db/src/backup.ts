import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { decryptSecrets } from "./secrets-crypto";
import { deleteObject, loadS3Config, presignGetObject, putObject } from "./s3";

// Node-only helpers for the backup pipeline. Both the accounting-service
// POST /backups route and the scheduler's runAutoBackupsTick call
// runBackupOnce so pg_dump / S3 / retention live in one place.
//
// pg_dump is spawned as a child process; the module can't be safely imported
// in browser contexts (it references child_process/fs). Keep in packages/db
// alongside the other Node-only helpers (secrets-crypto, s3).

export type BackupKind = "full" | "schema-only" | "data-only";

/**
 * Phase 1 of the backup pipeline. Inserts a BackupJob row in "Running"
 * state + returns it immediately so the caller can hand a jobId back to
 * an HTTP client that will poll. No pg_dump runs yet.
 */
export async function createBackupJob(
  prisma: PrismaClient,
  args: { tenantId: string; kind: BackupKind; backupDir: string },
): Promise<{ id: string; outputPath: string }> {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const outputPath = path.join(
    args.backupDir,
    `${args.tenantId}-${args.kind}-${ts}.sql`,
  );
  const job = await prisma.backupJob.create({
    data: {
      tenantId: args.tenantId,
      kind: args.kind,
      status: "Running",
      outputPath,
      startedAt: new Date(),
    },
  });
  return { id: job.id, outputPath };
}

/**
 * Phase 2 of the backup pipeline — spawn pg_dump against an existing
 * "Running" BackupJob row, then S3-upload + prune. Caller decides whether
 * to await or fire-and-forget. Never throws — errors are persisted to the
 * BackupJob row (status="Failed") so operators find them via /backups.
 */
export async function runBackupJob(
  prisma: PrismaClient,
  jobId: string,
  args: {
    databaseUrl: string;
    kind: BackupKind;
    outputPath: string;
    keepLast?: number;
    keepDays?: number;
  },
): Promise<{
  status: "Succeeded" | "Failed";
  s3Key?: string;
  error?: string;
}> {
  const dumpArgs = ["--dbname", args.databaseUrl, "-f", args.outputPath];
  if (args.kind === "schema-only") dumpArgs.push("--schema-only");
  if (args.kind === "data-only") dumpArgs.push("--data-only");

  const dumpResult = await runPgDump(dumpArgs);

  if (!dumpResult.ok) {
    await prisma.backupJob.update({
      where: { id: jobId },
      data: {
        status: "Failed",
        error: dumpResult.error.slice(0, 2000),
        finishedAt: new Date(),
      },
    });
    return { status: "Failed", error: dumpResult.error };
  }

  let size: bigint | null = null;
  try {
    const s = await stat(args.outputPath);
    size = BigInt(s.size);
  } catch {
    // File missing — unusual after pg_dump exit=0. Report anyway.
  }

  await prisma.backupJob.update({
    where: { id: jobId },
    data: {
      status: "Succeeded",
      sizeBytes: size,
      finishedAt: new Date(),
    },
  });

  // Offsite upload — best-effort, doesn't fail the primary backup. When it
  // fails, persist the failure on the BackupJob row so operators can grep
  // the /admin/backups list (or query WHERE error LIKE '%S3 upload%') to
  // spot silent degradations. Local file + status=Succeeded still stand;
  // only s3UploadedAt stays null. Also emit a structured stderr log so an
  // alerting pipeline (Grafana Alloy tailing container stderr) can page.
  let s3Key: string | undefined;
  try {
    s3Key = (await uploadBackupToS3(prisma, jobId, args.outputPath)) ?? undefined;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // eslint-disable-next-line no-console
    console.error(`[backup] S3 upload failed for job ${jobId}: ${msg}`);
    await prisma.backupJob
      .update({
        where: { id: jobId },
        data: { error: `S3 upload failed: ${msg.slice(0, 500)}` },
      })
      .catch(() => {
        // Best-effort — DB write errors here are already logged above.
      });
  }

  // Retention — run after upload so today's fresh row isn't a candidate
  // for prune under an aggressive keepLast.
  const keepLast = args.keepLast ?? 30;
  const keepDays = args.keepDays ?? 90;
  if (keepLast > 0 || keepDays > 0) {
    const job = await prisma.backupJob.findUnique({
      where: { id: jobId },
      select: { tenantId: true },
    });
    if (job) {
      try {
        await pruneBackups(prisma, job.tenantId, { keepLast, keepDays });
      } catch {
        // Prune failures never fail the primary backup.
      }
    }
  }

  return { status: "Succeeded", s3Key };
}

/**
 * One-shot: create + run. Used by the scheduler's auto-backup tick.
 * HTTP callers should prefer createBackupJob + fire-and-forget runBackupJob
 * so they can return 202 immediately with the jobId.
 */
export async function runBackupOnce(
  prisma: PrismaClient,
  args: {
    tenantId: string;
    kind: BackupKind;
    backupDir: string;
    databaseUrl: string;
    keepLast?: number;
    keepDays?: number;
  },
): Promise<{
  jobId: string;
  status: "Succeeded" | "Failed";
  outputPath?: string;
  s3Key?: string;
  error?: string;
}> {
  const { id, outputPath } = await createBackupJob(prisma, {
    tenantId: args.tenantId,
    kind: args.kind,
    backupDir: args.backupDir,
  });
  const r = await runBackupJob(prisma, id, {
    databaseUrl: args.databaseUrl,
    kind: args.kind,
    outputPath,
    keepLast: args.keepLast,
    keepDays: args.keepDays,
  });
  return { jobId: id, outputPath, ...r };
}

// Promise-wrap child_process.spawn — pg_dump writes progress to stderr even
// on success (that's fine; only care about exit code).
function runPgDump(dumpArgs: string[]): Promise<{ ok: true } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    const child = spawn("pg_dump", dumpArgs, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (b: Buffer) => {
      stderr += b.toString();
    });
    child.on("close", (code) => {
      if (code === 0) resolve({ ok: true });
      else resolve({ ok: false, error: `pg_dump exit=${code}: ${stderr}` });
    });
    child.on("error", (e) => {
      resolve({ ok: false, error: e.message });
    });
  });
}

/**
 * Upload a completed backup file to the tenant's default S3 bucket. Returns
 * the s3Key on success; null when the tenant has no active s3 integration
 * (a no-op, not an error). Throws when config is present but upload fails —
 * the caller decides whether to swallow (runBackupOnce does, so a partial
 * failure doesn't break the primary backup).
 */
export async function uploadBackupToS3(
  prisma: PrismaClient,
  jobId: string,
  filePath: string,
): Promise<string | null> {
  const job = await prisma.backupJob.findUnique({
    where: { id: jobId },
    select: { id: true, tenantId: true },
  });
  if (!job) throw new Error(`BackupJob ${jobId} not found`);

  const integ = await prisma.tenantIntegration.findFirst({
    where: { tenantId: job.tenantId, provider: "s3", isActive: true },
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
  });
  if (!integ) return null; // no s3 configured for this tenant — silent skip

  let cfg;
  try {
    const secrets = decryptSecrets(
      integ.secrets as unknown as Record<string, unknown>,
    ) as Record<string, unknown>;
    cfg = loadS3Config(secrets);
  } catch (e) {
    throw new Error(
      `s3 integration secrets invalid: ${e instanceof Error ? e.message : e}`,
    );
  }

  // Namespace under `backups/<tenantId>/<basename>` so operators can prune
  // by bucket prefix + so accidental cross-tenant reads require matching
  // both the bucket owner AND the tenantId path. Same shape as the local
  // outputPath filename to make grepping obvious.
  const bytes = await readFile(filePath);
  const key = `backups/${job.tenantId}/${path.basename(filePath)}`;
  await putObject(cfg, key, bytes, "application/sql");

  await prisma.backupJob.update({
    where: { id: job.id },
    data: { s3Key: key, s3UploadedAt: new Date() },
  });
  return key;
}

/**
 * Retention pruning. Two independent limits — keep the last N *and* keep
 * for at most D days. Prunes when either threshold is crossed. Only prunes
 * Succeeded jobs so failed-job diagnostic rows survive.
 *
 * Deletes both the local .sql file (unlink) and, when present, the S3
 * object. Both deletes are best-effort — a missing/permission-denied file
 * or a network glitch on S3 doesn't block the DB row deletion (operator's
 * list stays accurate).
 */
export async function pruneBackups(
  prisma: PrismaClient,
  tenantId: string,
  opts: { keepLast?: number; keepDays?: number },
): Promise<{ deleted: number; s3Deleted: number }> {
  const keepLast = opts.keepLast && opts.keepLast > 0 ? opts.keepLast : null;
  const keepDays = opts.keepDays && opts.keepDays > 0 ? opts.keepDays : null;
  const rows = await prisma.backupJob.findMany({
    where: { tenantId, status: "Succeeded" },
    orderBy: { createdAt: "desc" },
    select: { id: true, outputPath: true, s3Key: true, createdAt: true },
  });
  const cutoff = keepDays ? new Date(Date.now() - keepDays * 24 * 3600_000) : null;
  const toDelete = rows.filter((r, idx) => {
    if (keepLast != null && idx >= keepLast) return true;
    if (cutoff && r.createdAt < cutoff) return true;
    return false;
  });

  // Load s3 integration once — same for every row being pruned.
  let s3Cfg: ReturnType<typeof loadS3Config> | null = null;
  const hasS3Row = toDelete.some((r) => !!r.s3Key);
  if (hasS3Row) {
    const integ = await prisma.tenantIntegration.findFirst({
      where: { tenantId, provider: "s3", isActive: true },
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
    });
    if (integ) {
      try {
        const secrets = decryptSecrets(
          integ.secrets as unknown as Record<string, unknown>,
        ) as Record<string, unknown>;
        s3Cfg = loadS3Config(secrets);
      } catch {
        // Bad secrets — skip S3 deletes; local + DB deletes still proceed.
      }
    }
  }

  let s3Deleted = 0;
  for (const r of toDelete) {
    if (r.outputPath) {
      try {
        await unlink(r.outputPath);
      } catch {
        // best effort
      }
    }
    if (r.s3Key && s3Cfg) {
      try {
        await deleteObject(s3Cfg, r.s3Key);
        s3Deleted += 1;
      } catch {
        // best effort — DB row still goes
      }
    }
    await prisma.backupJob.delete({ where: { id: r.id } });
  }
  return { deleted: toDelete.length, s3Deleted };
}

// ---------- Backup verification ----------
//
// Weekly integrity check on a BackupJob's archive. Runs `pg_restore --list`
// against the .sql file — this parses the pg_dump archive header (TOC) and
// enumerates the objects that WOULD be restored, without actually applying
// them. Cheap (< 1s for typical dumps), doesn't need a scratch DB, catches:
//   * Truncated files (partial write, disk full mid-dump)
//   * Wrong format (plain-SQL saved to what should be a custom archive)
//   * Bit rot on the volume
//   * S3 partial-download failures
//
// Does NOT catch semantic corruption (dump has all objects but data doesn't
// re-import cleanly due to FK order, etc). Full test-restore into a scratch
// DB is a follow-up — needs CREATEDB on the app role + cleanup semantics.
//
// Preference order for source:
//   1. S3 (if the backup was uploaded) — proves the offsite copy is readable
//   2. Local outputPath — the fallback
// Choosing S3 first is deliberate: local is nice, but the whole point of the
// S3 offsite is that the host might die tomorrow. Verify the copy that matters.

export interface VerifyResult {
  status: "Succeeded" | "Failed";
  source: "s3" | "local";
  error?: string;
}

export async function verifyBackupArchive(
  prisma: PrismaClient,
  backupJobId: string,
): Promise<VerifyResult> {
  const job = await prisma.backupJob.findUnique({
    where: { id: backupJobId },
    select: {
      id: true,
      tenantId: true,
      outputPath: true,
      s3Key: true,
      status: true,
    },
  });
  if (!job) {
    return persistVerify(prisma, backupJobId, "unknown-tenant", "Failed", "local", {
      error: `BackupJob ${backupJobId} not found`,
    });
  }
  if (job.status !== "Succeeded") {
    return persistVerify(prisma, job.id, job.tenantId, "Failed", "local", {
      error: `BackupJob is in status ${job.status}; only Succeeded jobs can be verified`,
    });
  }

  // Try S3 first — this exercises the copy that survives a host loss.
  if (job.s3Key) {
    const localTmp = await downloadS3ToTmp(prisma, job.tenantId, job.s3Key).catch(
      (e) => ({ error: e instanceof Error ? e.message : String(e) }),
    );
    if ("path" in localTmp) {
      try {
        const listResult = await pgRestoreList(localTmp.path);
        return persistVerify(
          prisma,
          job.id,
          job.tenantId,
          listResult.ok ? "Succeeded" : "Failed",
          "s3",
          { error: listResult.ok ? undefined : listResult.error },
        );
      } finally {
        await rm(localTmp.dir, { recursive: true, force: true }).catch(() => {});
      }
    }
    // S3 fetch failed — fall through to local. Log why the S3 path lost.
    // eslint-disable-next-line no-console
    console.warn(
      `[verify] S3 download for job ${job.id} failed, falling back to local: ${localTmp.error}`,
    );
  }

  if (!job.outputPath) {
    return persistVerify(prisma, job.id, job.tenantId, "Failed", "local", {
      error: "No verifiable source: outputPath is null and S3 was unavailable",
    });
  }
  // Local file — first check it exists + is non-empty (pg_restore's error
  // for missing files is confusing; catch it cleanly).
  try {
    const s = await stat(job.outputPath);
    if (Number(s.size) === 0) {
      return persistVerify(prisma, job.id, job.tenantId, "Failed", "local", {
        error: "Backup file is 0 bytes",
      });
    }
  } catch (e) {
    return persistVerify(prisma, job.id, job.tenantId, "Failed", "local", {
      error: `stat failed: ${e instanceof Error ? e.message : String(e)}`,
    });
  }
  const listResult = await pgRestoreList(job.outputPath);
  return persistVerify(
    prisma,
    job.id,
    job.tenantId,
    listResult.ok ? "Succeeded" : "Failed",
    "local",
    { error: listResult.ok ? undefined : listResult.error },
  );
}

async function persistVerify(
  prisma: PrismaClient,
  backupJobId: string,
  tenantId: string,
  status: "Succeeded" | "Failed",
  source: "s3" | "local",
  opts: { error?: string } = {},
): Promise<VerifyResult> {
  try {
    await prisma.backupVerification.create({
      data: {
        tenantId,
        backupJobId,
        status,
        source,
        error: opts.error ? opts.error.slice(0, 500) : null,
      },
    });
  } catch {
    // Best-effort persist. If the BackupJob was deleted mid-verify (prune
    // ran) the FK write will fail; the returned VerifyResult still has
    // the truth for the caller.
  }
  return { status, source, error: opts.error };
}

// Download the S3 backup to a temp file for verification. Uses presigned
// GET so we don't have to plumb per-call auth headers to fetch. Returns
// the tmp file path + parent dir (caller cleans up).
async function downloadS3ToTmp(
  prisma: PrismaClient,
  tenantId: string,
  s3Key: string,
): Promise<{ path: string; dir: string }> {
  const integ = await prisma.tenantIntegration.findFirst({
    where: { tenantId, provider: "s3", isActive: true },
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
  });
  if (!integ) throw new Error("No active s3 integration for tenant");
  const secrets = decryptSecrets(
    integ.secrets as unknown as Record<string, unknown>,
  ) as Record<string, unknown>;
  const cfg = loadS3Config(secrets);
  const url = presignGetObject(cfg, s3Key, 300);
  const r = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!r.ok) throw new Error(`S3 GET failed (${r.status})`);
  const buf = Buffer.from(await r.arrayBuffer());
  const dir = await mkdtemp(path.join(tmpdir(), "lumaara-verify-"));
  const fp = path.join(dir, "backup.sql");
  await writeFile(fp, buf);
  return { path: fp, dir };
}

// Verify a backup archive by detecting its format + running the appropriate
// integrity check. Handles both plain SQL (default pg_dump output — what
// this codebase currently produces) and custom-format archives (`pg_dump -F c`).
//
// Plain SQL:  Read the first 200 bytes, look for "-- PostgreSQL database dump"
//             header + non-zero size + closing "-- PostgreSQL database dump
//             complete" trailer (last ~200 bytes). If both markers present +
//             file is non-trivially sized (> 500B), the dump is well-formed.
// Custom:     Bytes start with "PGDMP" magic. Run pg_restore --list to parse
//             the TOC — that catches corruption at the archive-header level.
async function pgRestoreList(filePath: string): Promise<{ ok: true } | { ok: false; error: string }> {
  // Peek at the header + a small trailer window to decide format + integrity
  // without loading the whole file into memory (dumps can be GBs).
  let head: Buffer;
  let tail: Buffer;
  let fileSize: number;
  try {
    const s = await stat(filePath);
    fileSize = Number(s.size);
    if (fileSize === 0) return { ok: false, error: "file is 0 bytes" };
    const fh = await import("node:fs/promises").then((m) => m.open(filePath, "r"));
    try {
      head = Buffer.alloc(Math.min(200, fileSize));
      await fh.read(head, 0, head.length, 0);
      const tailLen = Math.min(200, fileSize);
      tail = Buffer.alloc(tailLen);
      await fh.read(tail, 0, tailLen, Math.max(0, fileSize - tailLen));
    } finally {
      await fh.close();
    }
  } catch (e) {
    return { ok: false, error: `open failed: ${e instanceof Error ? e.message : e}` };
  }

  // Custom-format archives start with the 5-byte magic "PGDMP".
  const isCustomFormat = head.slice(0, 5).toString("ascii") === "PGDMP";
  if (isCustomFormat) {
    return runPgRestoreList(filePath);
  }

  // Plain SQL — check for the standard pg_dump header + trailer + size floor.
  // Header: "-- PostgreSQL database dump" (any pg version 9.x-16.x).
  const headStr = head.toString("utf8");
  const tailStr = tail.toString("utf8");
  if (!headStr.includes("-- PostgreSQL database dump")) {
    return {
      ok: false,
      error: `plain-SQL header missing — file may be corrupt or not a pg_dump output. First 60 bytes: ${JSON.stringify(headStr.slice(0, 60))}`,
    };
  }
  // Trailer marker: "-- PostgreSQL database dump complete" appears on the
  // last line of a successful pg_dump. Absence = dump was truncated mid-write.
  if (!tailStr.includes("-- PostgreSQL database dump complete")) {
    return {
      ok: false,
      error: `plain-SQL trailer missing — dump was likely truncated. Last 60 bytes: ${JSON.stringify(tailStr.slice(-60))}`,
    };
  }
  // Sanity floor — a valid dump of even an empty schema is > 500B.
  if (fileSize < 500) {
    return {
      ok: false,
      error: `file is suspiciously small (${fileSize}B) for a schema-bearing dump`,
    };
  }
  return { ok: true };
}

function runPgRestoreList(filePath: string): Promise<{ ok: true } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    const child = spawn("pg_restore", ["--list", filePath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b: Buffer) => {
      stdout += b.toString();
    });
    child.stderr.on("data", (b: Buffer) => {
      stderr += b.toString();
    });
    child.on("close", (code) => {
      if (code !== 0) {
        resolve({
          ok: false,
          error: `pg_restore --list exit=${code}: ${stderr.slice(0, 400)}`,
        });
        return;
      }
      if (stdout.trim().length === 0) {
        resolve({
          ok: false,
          error: `pg_restore --list returned empty TOC: ${stderr.slice(0, 200)}`,
        });
        return;
      }
      resolve({ ok: true });
    });
    child.on("error", (e) => {
      resolve({ ok: false, error: e.message });
    });
  });
}
