// Batch expiry tick — walks every tenant's Batches with expiryDate set +
// non-zero remaining qty and emits a Notification to that tenant's
// SystemManagers for each batch that's expired or within a
// tenant-configurable window (default 30d). Dedup via
// Batch.lastExpiryAlertAt so a batch that sits in the "expired" state
// doesn't spam every tick — we re-alert after `reAlertAfterDays` (default 7).
//
// Idempotency posture matches the other scheduler ticks: safe to double-
// fire on restart because `pickBatchesForAlert` respects lastExpiryAlertAt
// AND we only stamp the timestamp after successful notification writes.

import {
  classifyBatchExpiry,
  pickBatchesForAlert,
  prisma,
  withCrossTenant,
  type BatchExpiryLike,
} from "@lumaara/db";
import { getLogger } from "@lumaara/service-auth";

const log = getLogger("batch-expiry");

export interface BatchExpiryTickResult {
  tenantsChecked: number;
  batchesChecked: number;
  alertsEmitted: number;
  errors: number;
}

const WINDOW_DAYS = Number(process.env.BATCH_EXPIRY_WINDOW_DAYS ?? 30);
const RE_ALERT_AFTER_DAYS = Number(
  process.env.BATCH_EXPIRY_REALERT_DAYS ?? 7,
);
// Cap so a long outage across many tenants doesn't produce tens of
// thousands of Notification rows in one tick; subsequent ticks pick up
// the tail.
const MAX_ALERTS_PER_TICK = 500;

export async function runBatchExpiryTick(): Promise<BatchExpiryTickResult> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  // One pass across all tenants — batchQty > 0 and expiryDate set narrows
  // by index (@@index([tenantId, expiryDate])). We do the per-tenant
  // notification fanout inside the loop.
  const eligibleBatches = await prisma.batch.findMany(
    withCrossTenant({
      where: {
        disabled: false,
        expiryDate: { not: null },
        batchQty: { gt: 0 },
      },
      select: {
        id: true,
        tenantId: true,
        batchNo: true,
        itemId: true,
        expiryDate: true,
        batchQty: true,
        lastExpiryAlertAt: true,
        item: { select: { itemCode: true, itemName: true } },
      },
    }),
  );

  // Group by tenant so we can fetch each tenant's SystemManagers once.
  const byTenant = new Map<string, typeof eligibleBatches>();
  for (const b of eligibleBatches) {
    const arr = byTenant.get(b.tenantId) ?? [];
    arr.push(b);
    byTenant.set(b.tenantId, arr);
  }

  let batchesChecked = 0;
  let alertsEmitted = 0;
  let errors = 0;

  for (const [tenantId, batches] of byTenant) {
    if (alertsEmitted >= MAX_ALERTS_PER_TICK) break;

    // Pick the batches worth alerting on. `pickBatchesForAlert` handles
    // (a) status filter, (b) qty check (redundant with the DB filter but
    // cheap safety), (c) dedup by lastExpiryAlertAt.
    const picked = pickBatchesForAlert(
      batches.map((b): BatchExpiryLike => ({
        id: b.id,
        expiryDate: b.expiryDate,
        batchQty: b.batchQty,
        disabled: false,
        lastExpiryAlertAt: b.lastExpiryAlertAt,
      })),
      { today, windowDays: WINDOW_DAYS, reAlertAfterDays: RE_ALERT_AFTER_DAYS },
    );
    batchesChecked += batches.length;
    if (picked.length === 0) continue;

    // Fetch SystemManagers for THIS tenant. Roles are per-tenant; UserRole
    // is global (no tenantId column), so filter through role.tenantId.
    // Same pattern as backup-verify.ts.
    const managers = await prisma.userRole.findMany({
      where: { role: { tenantId, roleName: "SystemManager" } },
      select: { userId: true },
    });
    if (managers.length === 0) {
      // No SystemManager in the tenant → nobody to notify. Still stamp
      // lastExpiryAlertAt so we don't re-check the same batches every
      // tick.
      const ids = picked.map((p) => p.batch.id);
      await prisma.batch.updateMany({
        where: { id: { in: ids } },
        data: { lastExpiryAlertAt: today },
      });
      continue;
    }

    for (const { batch, result } of picked) {
      if (alertsEmitted >= MAX_ALERTS_PER_TICK) break;
      // Look up the full batch row (we sliced fields earlier for the
      // group query). Cheap re-lookup keeps the inner Notification
      // create body concise.
      const source = batches.find((b) => b.id === batch.id)!;
      const label =
        result.status === "expired"
          ? `expired ${-result.daysUntilExpiry!}d ago`
          : `expiring in ${result.daysUntilExpiry}d`;
      const subject = `Batch ${source.batchNo} of ${source.item.itemCode} — ${label}`;
      const body = `Batch ${source.batchNo} (${source.item.itemName}) has ${Number(source.batchQty).toFixed(2)} units remaining and ${label}. Consider discounting, transferring, or writing off before disposal is required.`;

      try {
        // Reclassify at the exact moment of write to make sure the
        // subject/body reflect the CURRENT state — batches sitting in
        // the pipeline between the top-of-tick classify and the write
        // are the edge case here.
        const live = classifyBatchExpiry(
          {
            id: source.id,
            expiryDate: source.expiryDate,
            batchQty: source.batchQty,
          },
          today,
          WINDOW_DAYS,
        );
        if (live.status !== "expired" && live.status !== "expiring") continue;

        await prisma.$transaction(async (tx) => {
          await tx.notification.createMany({
            data: managers.map((m) => ({
              tenantId,
              userId: m.userId,
              subject,
              body,
              doctype: "Batch",
              docId: source.id,
              category: "direct",
            })),
          });
          await tx.batch.update({
            where: { id: source.id },
            data: { lastExpiryAlertAt: today },
          });
        });
        alertsEmitted += managers.length;
      } catch (e) {
        errors++;
        log.warn("failed to process batch expiry", {
          batchId: source.id,
          tenantId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  return {
    tenantsChecked: byTenant.size,
    batchesChecked,
    alertsEmitted,
    errors,
  };
}
