-- Platform-level audit log for super-admin / cross-tenant operations.
-- See schema.prisma `SuperAdminAuditLog` + packages/service-auth
-- auditSuperAdmin middleware.

CREATE TABLE "super_admin_audit_logs" (
  "id"             TEXT         NOT NULL,
  "actorUserId"    TEXT,
  "actorEmail"     TEXT,
  "targetTenantId" TEXT,
  "operation"      TEXT         NOT NULL,
  "method"         TEXT         NOT NULL,
  "path"           TEXT         NOT NULL,
  "payload"        JSONB,
  "ipAddress"      TEXT,
  "userAgent"      TEXT,
  "statusCode"     INTEGER,
  "reason"         TEXT,
  "prevHash"       TEXT,
  "entryHash"      TEXT,
  "sequence"       INTEGER,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "super_admin_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "super_admin_audit_logs_actorUserId_createdAt_idx"
  ON "super_admin_audit_logs"("actorUserId", "createdAt");
CREATE INDEX "super_admin_audit_logs_targetTenantId_createdAt_idx"
  ON "super_admin_audit_logs"("targetTenantId", "createdAt");
CREATE INDEX "super_admin_audit_logs_createdAt_idx"
  ON "super_admin_audit_logs"("createdAt");
CREATE INDEX "super_admin_audit_logs_sequence_idx"
  ON "super_admin_audit_logs"("sequence");
