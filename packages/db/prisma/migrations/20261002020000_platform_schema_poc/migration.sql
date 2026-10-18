-- POC: move SubscriptionPlan + TenantSubscription tables into their own
-- Postgres schema `platform`. Pattern + runbook for extending to the
-- other 190+ tenant-scoped tables lives in docs/SCHEMA-MODULARIZATION.md.
--
-- Why ALTER TABLE SET SCHEMA (not Prisma's auto-migrate):
-- Prisma 5 treats `@@schema()` moves as DROP + CREATE in a new schema,
-- which destroys row data. To preserve data we move the tables manually
-- and then tell Prisma the migration is applied — on the next
-- `prisma generate` the client points at the new location.
--
-- Order:
--   1. CREATE SCHEMA
--   2. GRANT USAGE on the new schema to the lumaara_app role
--   3. ALTER TABLE ... SET SCHEMA — move the tables (keeps row data,
--      indexes, constraints, policies). FK references survive the move.
--   4. Default privileges so future tables (added via Prisma generate)
--      inherit the grants.

CREATE SCHEMA IF NOT EXISTS platform;

GRANT USAGE ON SCHEMA platform TO lumaara_app;

ALTER TABLE IF EXISTS public.subscription_plans   SET SCHEMA platform;
ALTER TABLE IF EXISTS public.tenant_subscriptions SET SCHEMA platform;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA platform TO lumaara_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA platform TO lumaara_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA platform GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO lumaara_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA platform GRANT USAGE, SELECT ON SEQUENCES TO lumaara_app;
