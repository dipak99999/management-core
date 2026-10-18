-- AlterTable: audit_logs hash chain (SOC 2 immutability trail).
-- Adds three nullable columns declared in schema.prisma but never migrated:
--   prevHash   — 64-hex chars, hash of the previous entry (chains rows per tenant)
--   entryHash  — 64-hex chars, hash of this entry
--   sequence   — strictly monotonic per tenant, catches insertions
-- Nullable so the migration is lock-free on write-hot rows; new writes
-- populate both, a background job backfills history.
ALTER TABLE "audit_logs"
  ADD COLUMN "prevHash" TEXT,
  ADD COLUMN "entryHash" TEXT,
  ADD COLUMN "sequence" INTEGER;

-- CreateIndex: matches @@index([tenantId, sequence]) in schema.prisma.
-- Supports the /audit-logs/verify endpoint's sequential scan per tenant.
CREATE INDEX "audit_logs_tenantId_sequence_idx" ON "audit_logs"("tenantId", "sequence");
