-- Billing / payment-gateway integration.
--
-- Platform-scoped tables (super admin owns them cross-tenant):
--   platform_billing_gateways  — Razorpay keys (encrypted)
--   billing_events             — webhook event log, idempotency by upstream id
--   billing_invoices           — per-charge history per tenant
--
-- Also adds Razorpay linkage columns to tenant_subscriptions. All of
-- these live in the `platform` Postgres schema (same schema as
-- subscription_plans + tenant_subscriptions).

CREATE TABLE IF NOT EXISTS platform.platform_billing_gateways (
    id              text PRIMARY KEY,
    provider        text NOT NULL,
    mode            text NOT NULL,
    "isActive"      boolean NOT NULL DEFAULT true,
    config          jsonb NOT NULL DEFAULT '{}'::jsonb,
    secrets         jsonb NOT NULL DEFAULT '{}'::jsonb,
    "lastTestedAt"  timestamp(3),
    "lastTestResult" text,
    "createdAt"     timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     timestamp(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS platform_billing_gateways_provider_mode_idx
  ON platform.platform_billing_gateways (provider, mode);

CREATE TABLE IF NOT EXISTS platform.billing_events (
    id              text PRIMARY KEY,
    "tenantId"      text,
    provider        text NOT NULL,
    "eventType"     text NOT NULL,
    "upstreamId"    text NOT NULL,
    payload         jsonb NOT NULL,
    "processedAt"   timestamp(3),
    "processError"  text,
    "createdAt"     timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS billing_events_provider_upstreamId_idx
  ON platform.billing_events (provider, "upstreamId");
CREATE INDEX IF NOT EXISTS billing_events_tenantId_eventType_idx
  ON platform.billing_events ("tenantId", "eventType");
CREATE INDEX IF NOT EXISTS billing_events_createdAt_idx
  ON platform.billing_events ("createdAt");

CREATE TABLE IF NOT EXISTS platform.billing_invoices (
    id                text PRIMARY KEY,
    "tenantId"        text NOT NULL,
    "planId"          text,
    "subscriptionId"  text,
    provider          text NOT NULL,
    "upstreamOrderId" text,
    "upstreamPaymentId" text,
    "amountInr"       decimal(14, 2) NOT NULL,
    currency          text NOT NULL DEFAULT 'INR',
    status            text NOT NULL,
    "periodStart"     timestamp(3),
    "periodEnd"       timestamp(3),
    metadata          jsonb NOT NULL DEFAULT '{}'::jsonb,
    "createdAt"       timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       timestamp(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS billing_invoices_tenantId_status_createdAt_idx
  ON platform.billing_invoices ("tenantId", status, "createdAt");
CREATE INDEX IF NOT EXISTS billing_invoices_upstreamOrderId_idx
  ON platform.billing_invoices ("upstreamOrderId");

-- Extend tenant_subscriptions with gateway linkage + billing-cycle fields.
ALTER TABLE platform.tenant_subscriptions
  ADD COLUMN IF NOT EXISTS "gatewayProvider"      text,
  ADD COLUMN IF NOT EXISTS "gatewayCustomerId"    text,
  ADD COLUMN IF NOT EXISTS "gatewaySubscriptionId" text,
  ADD COLUMN IF NOT EXISTS "currentPeriodStart"   timestamp(3),
  ADD COLUMN IF NOT EXISTS "currentPeriodEnd"     timestamp(3),
  ADD COLUMN IF NOT EXISTS "nextBillingAt"        timestamp(3),
  ADD COLUMN IF NOT EXISTS "cancelAtPeriodEnd"    boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS tenant_subscriptions_nextBillingAt_idx
  ON platform.tenant_subscriptions ("nextBillingAt");

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA platform TO lumaara_app;
