-- Add tenantId-leading indexes to four tenant-scoped tables that had
-- parent-scoped indexes only. Without these, direct queries like
--   prisma.workItem.findMany({ where: { tenantId } })
-- fall back to a full table scan.
--
-- Enforced going forward by scripts/check-tenant-index-coverage.ts
-- (run in CI via `pnpm --filter @lumaara/db check:tenant-index`).

CREATE INDEX IF NOT EXISTS "cliq_messages_tenantId_createdAt_idx"
  ON "cliq_messages"("tenantId", "createdAt");

CREATE INDEX IF NOT EXISTS "work_items_tenantId_status_idx"
  ON "work_items"("tenantId", "status");

CREATE INDEX IF NOT EXISTS "shipment_events_tenantId_ts_idx"
  ON "shipment_events"("tenantId", "ts");

CREATE INDEX IF NOT EXISTS "prescriptions_tenantId_createdAt_idx"
  ON "prescriptions"("tenantId", "createdAt");
