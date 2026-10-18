import { prisma, runAiInboxScan, withCrossTenant } from "@lumaara/db";
import { getLogger } from "@lumaara/service-auth";

// Nightly AI Inbox scan — walks every active tenant and runs all signal
// generators. Each tenant scan is bounded by a global catch so one slow
// / broken tenant can't stall the sweep.
//
// Env:
//   AI_INBOX_SCAN_ENABLE=1          activate the tick (default off — avoids
//                                   running on tenants that haven't opted in)
//   AI_INBOX_SCAN_INTERVAL_HOURS=6  per-tenant cadence (default: 6h)
//
// The scheduler calls runAiInboxScanTick() on its own cadence (the
// setInterval wiring lives in services/scheduler/src/index.ts).

const log = getLogger("scheduler");

export interface InboxScanTickResult {
  scannedTenants: number;
  totalInserted: number;
  totalRefreshed: number;
  errors: string[];
}

export async function runAiInboxScanTick(): Promise<InboxScanTickResult> {
  const result: InboxScanTickResult = {
    scannedTenants: 0,
    totalInserted: 0,
    totalRefreshed: 0,
    errors: [],
  };
  if (process.env.AI_INBOX_SCAN_ENABLE !== "1") return result;

  const intervalHours = Number(process.env.AI_INBOX_SCAN_INTERVAL_HOURS ?? 6);
  const cutoff = new Date(Date.now() - intervalHours * 60 * 60 * 1000);

  // Only scan tenants whose newest inbox entry is older than the cadence
  // (or who've never been scanned). Keeps the sweep cheap at scale.
  // Tenant has no `isActive` column; a tenant row's existence IS activity.
  const tenants = await prisma.tenant.findMany(withCrossTenant({
    select: {
      id: true, slug: true,
      // `as const` locks "desc" to the SortOrder literal — without it TS
      // widens to string and the whole findMany arg type is rejected.
      aiInsightInbox: { select: { lastSeenAt: true }, orderBy: { lastSeenAt: "desc" as const }, take: 1 },
    },
  }));

  for (const t of tenants) {
    const lastScan = t.aiInsightInbox[0]?.lastSeenAt;
    if (lastScan && lastScan > cutoff) continue; // scanned recently
    try {
      const r = await runAiInboxScan(t.id);
      result.scannedTenants++;
      result.totalInserted += r.inserted;
      result.totalRefreshed += r.refreshed;
      if (r.errors.length > 0) {
        for (const e of r.errors) result.errors.push(`${t.slug}: ${e}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error("ai-inbox scan failed for tenant", { tenantId: t.id, msg });
      result.errors.push(`${t.slug}: ${msg}`);
    }
  }
  return result;
}
