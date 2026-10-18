-- Subscription + module gating. See packages/db/prisma/schema.prisma §
-- SubscriptionPlan / TenantSubscription for the design intent.
--
-- Backfill: every existing tenant gets a default "All Access" plan with
-- every module/submodule enabled, so nothing breaks on first boot after
-- this migration applies. SuperAdmins can then edit plans or assign a
-- more restricted plan.

ALTER TABLE "users" ADD COLUMN "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "subscription_plans" (
  "id"                TEXT PRIMARY KEY,
  "tenantId"          TEXT NOT NULL,
  "name"              TEXT NOT NULL,
  "tier"              TEXT NOT NULL,
  "priceMonthlyInr"   DECIMAL(12, 2) NOT NULL DEFAULT 0,
  "allowedModules"    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "allowedSubmodules" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "isDefault"         BOOLEAN NOT NULL DEFAULT false,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "subscription_plans_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "subscription_plans_tenantId_name_key" UNIQUE ("tenantId", "name")
);
CREATE INDEX "subscription_plans_tenantId_idx" ON "subscription_plans"("tenantId");

CREATE TABLE "tenant_subscriptions" (
  "id"         TEXT PRIMARY KEY,
  "tenantId"   TEXT NOT NULL,
  "planId"     TEXT NOT NULL,
  "startDate"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endDate"    TIMESTAMP(3),
  "isActive"   BOOLEAN NOT NULL DEFAULT true,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tenant_subscriptions_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "tenant_subscriptions_planId_fkey"
    FOREIGN KEY ("planId") REFERENCES "subscription_plans"("id")
);
CREATE INDEX "tenant_subscriptions_tenantId_isActive_idx"
  ON "tenant_subscriptions"("tenantId", "isActive");

-- Backfill: one "All Access" plan per existing tenant + active subscription.
-- The modules + submodules strings must match packages/shared-types/src/
-- modules.ts exactly.
INSERT INTO "subscription_plans" (
  "id", "tenantId", "name", "tier", "priceMonthlyInr",
  "allowedModules", "allowedSubmodules", "isDefault", "updatedAt"
)
SELECT
  'plan-default-' || substr(md5(t."id" || 'default'), 1, 20),
  t."id",
  'All Access',
  'enterprise',
  0,
  ARRAY['hrms', 'payroll', 'finance', 'sales', 'manufacturing'],
  ARRAY[
    'hrms.employees', 'hrms.attendance', 'hrms.leave', 'hrms.recruitment',
    'hrms.onboarding', 'hrms.appraisals', 'hrms.training',
    'payroll.salary-slips', 'payroll.payroll-entries', 'payroll.loans',
    'payroll.salary-structures', 'payroll.tds-challans',
    'finance.customers', 'finance.suppliers', 'finance.sales-invoices',
    'finance.purchase-invoices', 'finance.payments', 'finance.journal-entries',
    'finance.accounts', 'finance.reports', 'finance.taxes', 'finance.assets',
    'finance.pos', 'finance.compliance',
    'sales.leads', 'sales.opportunities', 'sales.quotations', 'sales.sales-orders',
    'sales.campaigns', 'sales.webinars', 'sales.desk', 'sales.whatsapp',
    'sales.projects', 'sales.tasks',
    'manufacturing.warehouses', 'manufacturing.items', 'manufacturing.stock-entries',
    'manufacturing.delivery-notes', 'manufacturing.purchase-receipts',
    'manufacturing.work-orders', 'manufacturing.boms', 'manufacturing.production-plans',
    'manufacturing.quality-inspections'
  ],
  true,
  CURRENT_TIMESTAMP
FROM "tenants" t;

INSERT INTO "tenant_subscriptions" (
  "id", "tenantId", "planId", "startDate", "isActive", "updatedAt"
)
SELECT
  'sub-default-' || substr(md5(t."id" || 'sub'), 1, 20),
  t."id",
  p."id",
  CURRENT_TIMESTAMP,
  true,
  CURRENT_TIMESTAMP
FROM "tenants" t
JOIN "subscription_plans" p ON p."tenantId" = t."id" AND p."isDefault" = true;
