-- AI advisory cache per (doctype, docId). TTL enforced at the application layer.
CREATE TABLE "entity_insights" (
  "id"               TEXT        NOT NULL,
  "tenantId"         TEXT        NOT NULL,
  "doctype"          TEXT        NOT NULL,
  "docId"            TEXT        NOT NULL,
  "payloadJson"      JSONB       NOT NULL,
  "model"            TEXT,
  "inputFingerprint" TEXT        NOT NULL,
  "generatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "entity_insights_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "entity_insights_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "entity_insights_tenantId_doctype_docId_key"
  ON "entity_insights" ("tenantId", "doctype", "docId");

CREATE INDEX "entity_insights_tenantId_generatedAt_idx"
  ON "entity_insights" ("tenantId", "generatedAt");
