import { prisma, runBackupOnce, withCrossTenant } from "@lumaara/db";
import { getLogger } from "@lumaara/service-auth";

// Daily-ish auto-backup for every tenant with an active `provider="s3"`
// TenantIntegration configured. The rationale: if a tenant took the trouble
// to wire S3, they clearly want off-host copies — running an unattended
// daily is the right default. Tenants without S3 fall through (their host
// volume is the only copy; on-demand backups via the admin UI still work).
//
// Env:
//   BACKUP_AUTO_ENABLE=1         — set to activate the tick (default off)
//   BACKUP_AUTO_INTERVAL_HOURS   — hours between successful runs per
//                                  tenant (default 24)
//   BACKUP_KEEP_LAST             — passed through to runBackupOnce (default 30)
//   BACKUP_KEEP_DAYS             — passed through to runBackupOnce (default 90)
//   BACKUP_DIR                   — same as the accounting-service route
//                                  (default /tmp/lumaara-backups)
//   DATABASE_URL                 — same DB the pg_dump targets
//
// The tick runs hourly (scheduler wires the setInterval); per-tenant cadence
// is enforced by checking `now - lastSucceededBackup >= interval`.

const log = getLogger("scheduler");

export interface AutoBackupResult {
  scanned: number;
  triggered: number;
  succeeded: number;
  failed: number;
  skipped: number;
  errors: string[];
}

export async function runAutoBackupsTick(): Promise<AutoBackupResult> {
  const result: AutoBackupResult = {
    scanned: 0,
    triggered: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  };

  if (process.env.BACKUP_AUTO_ENABLE !== "1") {
    return result;
  }

  const intervalHours = Number(process.env.BACKUP_AUTO_INTERVAL_HOURS ?? 24);
  const keepLast = Number(process.env.BACKUP_KEEP_LAST ?? 30);
  const keepDays = Number(process.env.BACKUP_KEEP_DAYS ?? 90);
  const backupDir = process.env.BACKUP_DIR ?? "/tmp/lumaara-backups";
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    result.errors.push("DATABASE_URL not set");
    return result;
  }

  // Find every tenant with at least one active s3 integration. That's the
  // opt-in signal. Cross-tenant guard escape: the query below spans all
  // tenants intentionally (scheduler is trusted infra).
  const s3Integrations = await prisma.tenantIntegration.findMany(
    withCrossTenant({
      where: { provider: "s3", isActive: true },
      select: { tenantId: true },
    }),
  );
  const tenantIds = Array.from(new Set(s3Integrations.map((s) => s.tenantId)));
  result.scanned = tenantIds.length;

  const cutoff = new Date(Date.now() - intervalHours * 3600_000);

  for (const tenantId of tenantIds) {
    // Skip if a Succeeded backup already exists inside the current window.
    const recent = await prisma.backupJob.findFirst({
      where: {
        tenantId,
        status: "Succeeded",
        finishedAt: { gte: cutoff },
      },
      select: { id: true },
    });
    if (recent) {
      result.skipped += 1;
      continue;
    }

    result.triggered += 1;
    try {
      const r = await runBackupOnce(prisma, {
        tenantId,
        kind: "full",
        backupDir,
        databaseUrl,
        keepLast,
        keepDays,
      });
      if (r.status === "Succeeded") result.succeeded += 1;
      else {
        result.failed += 1;
        if (r.error) result.errors.push(`${tenantId}: ${r.error.slice(0, 200)}`);
      }
    } catch (e) {
      result.failed += 1;
      result.errors.push(
        `${tenantId}: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`,
      );
    }
  }

  log.info("auto-backup tick", {
    scanned: result.scanned,
    triggered: result.triggered,
    succeeded: result.succeeded,
    failed: result.failed,
    skipped: result.skipped,
  });
  return result;
}
