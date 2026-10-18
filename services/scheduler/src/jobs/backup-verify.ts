import { prisma, verifyBackupArchive, withCrossTenant } from "@lumaara/db";
import { getLogger } from "@lumaara/service-auth";

// Weekly backup verification tick. For each tenant with a Succeeded
// BackupJob in the last N days AND no BackupVerification in the past week,
// runs verifyBackupArchive (pg_restore --list for custom-format, or
// header+trailer inspection for plain SQL). Persists a BackupVerification
// row + emits an in-app Notification on failure so ops team is paged.
//
// Env (all optional):
//   BACKUP_VERIFY_ENABLE=1               — activate the tick (default off)
//   BACKUP_VERIFY_INTERVAL_HOURS=168     — per-tenant cadence (default 7d)
//   BACKUP_VERIFY_LOOKBACK_DAYS=30       — how far back to search for a
//                                          Succeeded backup to verify

const log = getLogger("scheduler");

export interface VerifyTickResult {
  scanned: number;
  verified: number;
  succeeded: number;
  failed: number;
  skipped: number;
  errors: string[];
}

export async function runBackupVerifyTick(): Promise<VerifyTickResult> {
  const result: VerifyTickResult = {
    scanned: 0,
    verified: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  };

  if (process.env.BACKUP_VERIFY_ENABLE !== "1") {
    return result;
  }

  const intervalHours = Number(process.env.BACKUP_VERIFY_INTERVAL_HOURS ?? 168);
  const lookbackDays = Number(process.env.BACKUP_VERIFY_LOOKBACK_DAYS ?? 30);
  const now = Date.now();
  const intervalCutoff = new Date(now - intervalHours * 3600_000);
  const lookbackCutoff = new Date(now - lookbackDays * 24 * 3600_000);

  // Find every tenant that has at least one Succeeded backup in the lookback
  // window. Cross-tenant scan — scheduler is trusted infra.
  const tenants = await prisma.backupJob.groupBy(
    withCrossTenant({
      by: ["tenantId"],
      where: {
        status: "Succeeded",
        createdAt: { gte: lookbackCutoff },
      },
    }),
  );
  result.scanned = tenants.length;

  for (const { tenantId } of tenants) {
    // Skip if a verification already ran for this tenant inside the interval.
    const recentVerify = await prisma.backupVerification.findFirst({
      where: { tenantId, verifiedAt: { gte: intervalCutoff } },
      select: { id: true },
    });
    if (recentVerify) {
      result.skipped += 1;
      continue;
    }

    // Pick the newest Succeeded backup — that's the one we care about.
    const job = await prisma.backupJob.findFirst({
      where: {
        tenantId,
        status: "Succeeded",
        createdAt: { gte: lookbackCutoff },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (!job) {
      result.skipped += 1;
      continue;
    }

    result.verified += 1;
    try {
      const r = await verifyBackupArchive(prisma, job.id);
      if (r.status === "Succeeded") {
        result.succeeded += 1;
      } else {
        result.failed += 1;
        result.errors.push(
          `${tenantId} (${r.source}): ${r.error?.slice(0, 200) ?? "unknown"}`,
        );
        await notifyOfFailure(tenantId, job.id, r.error ?? "unknown");
      }
    } catch (e) {
      result.failed += 1;
      const msg = e instanceof Error ? e.message.slice(0, 200) : String(e);
      result.errors.push(`${tenantId}: ${msg}`);
    }
  }

  log.info("backup-verify tick", {
    scanned: result.scanned,
    verified: result.verified,
    succeeded: result.succeeded,
    failed: result.failed,
    skipped: result.skipped,
  });
  return result;
}

// Emit an in-app Notification to every SystemManager in the failing
// tenant. The auth-service notification write path (see notifications.ts)
// fans out to Slack when the tenant has a slack integration + the user
// has direct-category deliveries enabled in NotificationPreference.
async function notifyOfFailure(
  tenantId: string,
  backupJobId: string,
  errorMsg: string,
): Promise<void> {
  // UserRole is global (no tenantId column) — the tenant scope lives on
  // the Role row. Nest the filter through `role` so we only fan out to
  // SystemManagers of the FAILING tenant, not every SystemManager across
  // tenants.
  const managers = await prisma.userRole.findMany({
    where: {
      role: { tenantId, roleName: "SystemManager" },
    },
    select: { userId: true },
  });
  if (managers.length === 0) return;

  await prisma.notification.createMany({
    data: managers.map((m) => ({
      tenantId,
      userId: m.userId,
      subject: "Backup integrity check failed",
      body: `Latest backup (job ${backupJobId}) failed verification: ${errorMsg.slice(0, 200)}. Investigate immediately — the offsite copy may be unusable if you need to restore.`,
      doctype: "BackupJob",
      docId: backupJobId,
      // "direct" category → follows the recipient's default NotificationPreference;
      // Slack fanout gated by their prefs + tenant slack integration.
      category: "direct",
    })),
  });
}
