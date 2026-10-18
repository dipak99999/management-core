-- Extended inbox prefs: per-category frequency JSON + Slack/Teams webhook.
ALTER TABLE "ai_inbox_preferences"
  ADD COLUMN "categoryFrequency" JSONB,
  ADD COLUMN "webhookUrl"        TEXT,
  ADD COLUMN "webhookType"       TEXT;

-- Tenant-level inbox config (currently just the LLM prompt override).
CREATE TABLE "ai_inbox_tenant_config" (
  "id"              TEXT         NOT NULL,
  "tenantId"        TEXT         NOT NULL,
  "llmSystemPrompt" TEXT,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_inbox_tenant_config_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_inbox_tenant_config_tenantId_fkey" FOREIGN KEY ("tenantId")
    REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ai_inbox_tenant_config_tenantId_key" ON "ai_inbox_tenant_config" ("tenantId");
