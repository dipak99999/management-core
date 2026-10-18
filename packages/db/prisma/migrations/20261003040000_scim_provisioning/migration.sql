-- SCIM 2.0 provisioning: new ScimToken table + user activity fields.
ALTER TABLE "users"
  ADD COLUMN "active"        BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "externalId"    TEXT,
  ADD COLUMN "deactivatedAt" TIMESTAMP(3);

CREATE INDEX "users_tenantId_externalId_idx" ON "users" ("tenantId", "externalId");

CREATE TABLE "scim_tokens" (
  "id"              TEXT        NOT NULL,
  "tenantId"        TEXT        NOT NULL,
  "name"            TEXT        NOT NULL,
  "prefix"          TEXT        NOT NULL,
  "tokenHash"       TEXT        NOT NULL,
  "defaultRole"     TEXT        NOT NULL DEFAULT 'admin',
  "createdByUserId" TEXT,
  "revokedAt"       TIMESTAMP(3),
  "lastUsedAt"      TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "scim_tokens_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "scim_tokens_tenantId_fkey" FOREIGN KEY ("tenantId")
    REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "scim_tokens_tokenHash_key" ON "scim_tokens" ("tokenHash");
CREATE INDEX "scim_tokens_tenantId_revokedAt_idx" ON "scim_tokens" ("tenantId", "revokedAt");
