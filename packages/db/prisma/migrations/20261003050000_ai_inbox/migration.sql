-- AI Inbox — proactive-insight stream per tenant.
CREATE TABLE "ai_insight_inbox" (
  "id"             TEXT         NOT NULL,
  "tenantId"       TEXT         NOT NULL,
  "signalKey"      TEXT         NOT NULL,
  "kind"           TEXT         NOT NULL,
  "severity"       TEXT         NOT NULL DEFAULT 'info',
  "category"       TEXT         NOT NULL,
  "title"          TEXT         NOT NULL,
  "finding"        TEXT         NOT NULL,
  "targetDoctype"  TEXT,
  "targetDocId"    TEXT,
  "actionLabel"    TEXT,
  "actionHref"     TEXT,
  "dataJson"       JSONB,
  "firstSeenAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acknowledgedAt" TIMESTAMP(3),
  "acknowledgedBy" TEXT,
  "dismissedAt"    TIMESTAMP(3),
  "dismissedUntil" TIMESTAMP(3),
  "dismissedBy"    TEXT,
  CONSTRAINT "ai_insight_inbox_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_insight_inbox_tenantId_fkey" FOREIGN KEY ("tenantId")
    REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ai_insight_inbox_tenantId_signalKey_key"
  ON "ai_insight_inbox" ("tenantId", "signalKey");
CREATE INDEX "ai_insight_inbox_tenantId_acknowledgedAt_dismissedAt_idx"
  ON "ai_insight_inbox" ("tenantId", "acknowledgedAt", "dismissedAt");
CREATE INDEX "ai_insight_inbox_tenantId_severity_lastSeenAt_idx"
  ON "ai_insight_inbox" ("tenantId", "severity", "lastSeenAt");
