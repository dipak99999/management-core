-- Postgres Row-Level Security — defense in depth.
--
-- Even if application code forgets `where.tenantId` (and the Prisma
-- tenant-guard middleware has a bug), the database refuses to return
-- rows unless the current session's `app.current_tenant_id` setting
-- matches the row's `tenantId` column. A SQL injection that bypasses
-- Prisma can't cross tenants.
--
-- This POC enables RLS on 5 financially-sensitive tables. Every other
-- tenant-scoped table should follow the same pattern — see
-- docs/RLS.md for the extension runbook.
--
-- The policy reads `app.current_tenant_id` from the session; every API
-- request's middleware (packages/service-auth/src/tenant-session.ts) sets
-- it inside a transaction before any Prisma call. If the var isn't set,
-- `current_setting(..., true)` returns NULL and no rows match → the query
-- returns an empty result instead of leaking data.
--
-- Super-admin escape hatch: set `app.bypass_rls = 'true'` in the session
-- to skip the policy entirely (used by the super-admin UI).

-- Helper: current effective tenant for this session (NULL if unset).
CREATE OR REPLACE FUNCTION app_current_tenant_id() RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT NULLIF(current_setting('app.current_tenant_id', true), '')
$$;

-- Helper: is this session the super-admin bypass?
CREATE OR REPLACE FUNCTION app_bypass_rls() RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT COALESCE(current_setting('app.bypass_rls', true), '') = 'true'
$$;

-- Enable RLS + policy on the 5 highest-value financial tables.
-- Repeat this block for every other tenant-scoped table (see RLS.md).

ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customers" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "customers"
  USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id())
  WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id());

ALTER TABLE "sales_invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sales_invoices" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "sales_invoices"
  USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id())
  WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id());

ALTER TABLE "payment_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_entries" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "payment_entries"
  USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id())
  WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id());

ALTER TABLE "gl_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gl_entries" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "gl_entries"
  USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id())
  WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id());

ALTER TABLE "salary_slips" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "salary_slips" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "salary_slips"
  USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id())
  WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id());
