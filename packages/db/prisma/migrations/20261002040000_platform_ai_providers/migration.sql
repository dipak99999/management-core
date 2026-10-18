-- PlatformAiProvider lives in the `platform` schema (same schema that
-- holds SubscriptionPlan + TenantSubscription). Super admins configure
-- Claude / OpenAI / Brew keys here as the fallback for every tenant.
-- Secrets JSON column stores the apiKey encrypted via secrets-crypto.

CREATE TABLE IF NOT EXISTS platform.platform_ai_providers (
    id              text PRIMARY KEY,
    provider        text NOT NULL,
    label           text NOT NULL,
    "isActive"      boolean NOT NULL DEFAULT true,
    "isDefault"     boolean NOT NULL DEFAULT false,
    priority        integer NOT NULL DEFAULT 100,
    "defaultModel"  text,
    "baseUrl"       text,
    config          jsonb NOT NULL DEFAULT '{}'::jsonb,
    secrets         jsonb NOT NULL DEFAULT '{}'::jsonb,
    "lastTestedAt"  timestamp(3),
    "lastTestResult" text,
    "createdAt"     timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     timestamp(3) NOT NULL
);

CREATE INDEX IF NOT EXISTS platform_ai_providers_provider_isActive_idx
  ON platform.platform_ai_providers (provider, "isActive");
CREATE INDEX IF NOT EXISTS platform_ai_providers_isDefault_isActive_idx
  ON platform.platform_ai_providers ("isDefault", "isActive");

GRANT SELECT, INSERT, UPDATE, DELETE
  ON platform.platform_ai_providers
  TO lumaara_app;
