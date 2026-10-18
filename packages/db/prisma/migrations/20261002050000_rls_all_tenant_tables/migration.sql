-- Extend Row-Level Security to every tenant-scoped table.
--
-- Builds on the POC in 20261002010000_rls_poc which enabled RLS on 5
-- financially-sensitive tables. This migration applies the same template
-- to the remaining 313 tenant-scoped tables in the public schema.
--
-- Pattern per table:
--   1. ALTER TABLE ... ENABLE ROW LEVEL SECURITY — turns the gate on.
--   2. ALTER TABLE ... FORCE ROW LEVEL SECURITY — enforces for the owner
--      role too (otherwise table-owner connections bypass).
--   3. CREATE POLICY tenant_isolation ... — the row filter. Reuses the
--      app_current_tenant_id() + app_bypass_rls() helpers from the POC.
--
-- Idempotent: `IF NOT EXISTS` on CREATE POLICY so re-running the migration
-- (or applying on top of the POC) is a no-op for tables already covered.
--
-- Services connect as `lumaara_app` (NOSUPERUSER + NOBYPASSRLS) once
-- `RLS_ENFORCE=true` is flipped — see PRODUCTION.md § 1 for the switch.
-- Until then, the postgres superuser bypasses RLS and nothing changes
-- operationally. This migration just lays the groundwork.

-- Defensive: ensure the four agent/embeddings tables exist before applying
-- RLS to them. These models landed in schema.prisma without dedicated
-- CREATE TABLE migrations — the main dev DB got them via `prisma db push`.
-- Fresh databases (including the test DB on CI) need these CREATE IF NOT
-- EXISTS so the ALTER TABLE statements below don't fail with "relation
-- does not exist". Column defs mirror what `prisma db push` emits so a
-- subsequent `prisma generate` sees no drift.

-- agent_policies
CREATE TABLE IF NOT EXISTS "agent_policies" (
  "id"                 TEXT NOT NULL,
  "tenantId"           TEXT NOT NULL,
  "key"                TEXT NOT NULL,
  "maxStepsPerTask"    INTEGER NOT NULL DEFAULT 50,
  "maxCostUsdPerTask"  DECIMAL(8,4) NOT NULL DEFAULT 1,
  "allowedDoctypes"    TEXT[] DEFAULT ARRAY[]::TEXT[],
  "humanApprovalMode"  TEXT NOT NULL DEFAULT 'Draft',
  "toolAllowlist"      TEXT[] DEFAULT ARRAY[]::TEXT[],
  "toolDenylist"       TEXT[] DEFAULT ARRAY[]::TEXT[],
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL,
  CONSTRAINT "agent_policies_pkey" PRIMARY KEY ("id")
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='agent_policies_tenantId_key_key') THEN
    CREATE UNIQUE INDEX "agent_policies_tenantId_key_key" ON "agent_policies"("tenantId", "key");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='agent_policies_tenantId_fkey') THEN
    ALTER TABLE "agent_policies" ADD CONSTRAINT "agent_policies_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- agent_tasks
CREATE TABLE IF NOT EXISTS "agent_tasks" (
  "id"                TEXT NOT NULL,
  "tenantId"          TEXT NOT NULL,
  "name"              TEXT NOT NULL,
  "agentKind"         TEXT NOT NULL,
  "goal"              TEXT NOT NULL,
  "contextJson"       JSONB NOT NULL DEFAULT '{}'::jsonb,
  "planJson"          JSONB,
  "status"            TEXT NOT NULL DEFAULT 'Queued',
  "policyId"          TEXT,
  "startedByUserId"   TEXT,
  "startedAt"         TIMESTAMP(3),
  "completedAt"       TIMESTAMP(3),
  "totalCostUsd"      DECIMAL(10,6) NOT NULL DEFAULT 0,
  "errorMessage"      TEXT,
  "escalatedStepId"   TEXT,
  "escalatedToUserId" TEXT,
  "resumeToken"       TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "agent_tasks_pkey" PRIMARY KEY ("id")
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='agent_tasks_tenantId_name_key') THEN
    CREATE UNIQUE INDEX "agent_tasks_tenantId_name_key" ON "agent_tasks"("tenantId","name");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='agent_tasks_resumeToken_key') THEN
    CREATE UNIQUE INDEX "agent_tasks_resumeToken_key" ON "agent_tasks"("resumeToken");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='agent_tasks_tenantId_status_idx') THEN
    CREATE INDEX "agent_tasks_tenantId_status_idx" ON "agent_tasks"("tenantId","status");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='agent_tasks_tenantId_agentKind_status_idx') THEN
    CREATE INDEX "agent_tasks_tenantId_agentKind_status_idx" ON "agent_tasks"("tenantId","agentKind","status");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='agent_tasks_tenantId_fkey') THEN
    ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='agent_tasks_policyId_fkey') THEN
    ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_policyId_fkey"
      FOREIGN KEY ("policyId") REFERENCES "agent_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- agent_steps — base shape BEFORE the undo/redo columns are added by later
-- migrations (20261003010000_agent_step_undo + 20261003020000_agent_step_redo).
-- Including them here would make those migrations fail with
-- "column already exists". Those migrations ADD the undoneAt/redoneAt +
-- the undoneAt_finishedAt index.
CREATE TABLE IF NOT EXISTS "agent_steps" (
  "id"                TEXT NOT NULL,
  "tenantId"          TEXT NOT NULL,
  "taskId"            TEXT NOT NULL,
  "ordinal"           INTEGER NOT NULL,
  "kind"              TEXT NOT NULL,
  "toolName"          TEXT,
  "inputJson"         JSONB,
  "outputJson"        JSONB,
  "provider"          TEXT,
  "model"             TEXT,
  "inputTokens"       INTEGER NOT NULL DEFAULT 0,
  "outputTokens"      INTEGER NOT NULL DEFAULT 0,
  "costUsd"           DECIMAL(10,6) NOT NULL DEFAULT 0,
  "latencyMs"         INTEGER NOT NULL DEFAULT 0,
  "status"            TEXT NOT NULL DEFAULT 'Pending',
  "errorMessage"      TEXT,
  "startedAt"         TIMESTAMP(3),
  "finishedAt"        TIMESTAMP(3),
  CONSTRAINT "agent_steps_pkey" PRIMARY KEY ("id")
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='agent_steps_taskId_ordinal_key') THEN
    CREATE UNIQUE INDEX "agent_steps_taskId_ordinal_key" ON "agent_steps"("taskId","ordinal");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='agent_steps_tenantId_status_idx') THEN
    CREATE INDEX "agent_steps_tenantId_status_idx" ON "agent_steps"("tenantId","status");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='agent_steps_tenantId_fkey') THEN
    ALTER TABLE "agent_steps" ADD CONSTRAINT "agent_steps_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='agent_steps_taskId_fkey') THEN
    ALTER TABLE "agent_steps" ADD CONSTRAINT "agent_steps_taskId_fkey"
      FOREIGN KEY ("taskId") REFERENCES "agent_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  -- agent_tasks.escalatedStepId FK + its unique index (depend on agent_steps existing)
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='agent_tasks_escalatedStepId_key') THEN
    CREATE UNIQUE INDEX "agent_tasks_escalatedStepId_key" ON "agent_tasks"("escalatedStepId");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='agent_tasks_escalatedStepId_fkey') THEN
    ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_escalatedStepId_fkey"
      FOREIGN KEY ("escalatedStepId") REFERENCES "agent_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- embeddings (vector cache for AI chat context)
CREATE TABLE IF NOT EXISTS "embeddings" (
  "id"           TEXT NOT NULL,
  "tenantId"     TEXT NOT NULL,
  "doctype"      TEXT NOT NULL,
  "docId"        TEXT NOT NULL,
  "title"        TEXT NOT NULL,
  "content"      TEXT NOT NULL,
  "contentHash"  TEXT NOT NULL,
  "vector"       JSONB NOT NULL DEFAULT '[]'::jsonb,
  "vectorLength" INTEGER NOT NULL DEFAULT 0,
  "provider"     TEXT,
  "model"        TEXT,
  "stale"        BOOLEAN NOT NULL DEFAULT true,
  "embeddedAt"   TIMESTAMP(3),
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "embeddings_pkey" PRIMARY KEY ("id")
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='embeddings_tenantId_doctype_docId_key') THEN
    CREATE UNIQUE INDEX "embeddings_tenantId_doctype_docId_key" ON "embeddings"("tenantId","doctype","docId");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='embeddings_tenantId_doctype_stale_idx') THEN
    CREATE INDEX "embeddings_tenantId_doctype_stale_idx" ON "embeddings"("tenantId","doctype","stale");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='embeddings_tenantId_stale_updatedAt_idx') THEN
    CREATE INDEX "embeddings_tenantId_stale_updatedAt_idx" ON "embeddings"("tenantId","stale","updatedAt");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='embeddings_tenantId_fkey') THEN
    ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "accounts" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='accounts' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "accounts" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "addresses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "addresses" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='addresses' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "addresses" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "adhoc_payment_recoveries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "adhoc_payment_recoveries" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='adhoc_payment_recoveries' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "adhoc_payment_recoveries" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "agent_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agent_policies" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='agent_policies' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "agent_policies" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "agent_steps" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agent_steps" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='agent_steps' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "agent_steps" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "agent_tasks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agent_tasks" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='agent_tasks' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "agent_tasks" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "agile_workspaces" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agile_workspaces" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='agile_workspaces' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "agile_workspaces" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "ai_extraction_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_extraction_jobs" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='ai_extraction_jobs' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "ai_extraction_jobs" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "ai_ticket_suggestions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_ticket_suggestions" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='ai_ticket_suggestions' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "ai_ticket_suggestions" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "analytics_share_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "analytics_share_links" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='analytics_share_links' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "analytics_share_links" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "anonymization_archives" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "anonymization_archives" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='anonymization_archives' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "anonymization_archives" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "api_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "api_tokens" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='api_tokens' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "api_tokens" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "appraisal_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "appraisal_templates" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='appraisal_templates' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "appraisal_templates" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "appraisals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "appraisals" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='appraisals' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "appraisals" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "approver_hierarchies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "approver_hierarchies" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='approver_hierarchies' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "approver_hierarchies" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "assessment_results" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assessment_results" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='assessment_results' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "assessment_results" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "assessments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assessments" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='assessments' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "assessments" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "asset_categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "asset_categories" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='asset_categories' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "asset_categories" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "assets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assets" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='assets' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "assets" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "attachments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attachments" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='attachments' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "attachments" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "attendance_regularizations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attendance_regularizations" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='attendance_regularizations' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "attendance_regularizations" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "attendances" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attendances" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='attendances' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "attendances" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "attribution_touchpoints" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attribution_touchpoints" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='attribution_touchpoints' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "attribution_touchpoints" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='audit_logs' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "audit_logs" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "auto_dealers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "auto_dealers" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='auto_dealers' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "auto_dealers" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "availability_windows" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "availability_windows" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='availability_windows' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "availability_windows" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "backup_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "backup_jobs" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='backup_jobs' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "backup_jobs" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "backup_verifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "backup_verifications" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='backup_verifications' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "backup_verifications" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "bank_guarantees" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bank_guarantees" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='bank_guarantees' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "bank_guarantees" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "bank_statements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bank_statements" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='bank_statements' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "bank_statements" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "bank_transactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bank_transactions" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='bank_transactions' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "bank_transactions" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "batches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "batches" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='batches' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "batches" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "bins" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bins" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='bins' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "bins" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "blanket_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "blanket_orders" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='blanket_orders' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "blanket_orders" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "blog_posts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "blog_posts" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='blog_posts' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "blog_posts" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "boms" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "boms" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='boms' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "boms" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "bonuses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bonuses" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='bonuses' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "bonuses" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "booked_meetings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "booked_meetings" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='booked_meetings' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "booked_meetings" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "branches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "branches" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='branches' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "branches" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "brand_kits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "brand_kits" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='brand_kits' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "brand_kits" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "broadcasts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "broadcasts" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='broadcasts' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "broadcasts" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "budgets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "budgets" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='budgets' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "budgets" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "bundle_components" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bundle_components" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='bundle_components' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "bundle_components" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "campaign_recipients" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "campaign_recipients" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='campaign_recipients' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "campaign_recipients" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "campaign_variants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "campaign_variants" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='campaign_variants' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "campaign_variants" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "campaigns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "campaigns" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='campaigns' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "campaigns" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "cliq_channels" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cliq_channels" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='cliq_channels' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "cliq_channels" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "cliq_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cliq_messages" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='cliq_messages' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "cliq_messages" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "comments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "comments" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='comments' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "comments" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "companies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "companies" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='companies' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "companies" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "company_accommodations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "company_accommodations" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='company_accommodations' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "company_accommodations" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "consent_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "consent_records" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='consent_records' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "consent_records" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "contact_lists" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contact_lists" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='contact_lists' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "contact_lists" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "contacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contacts" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='contacts' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "contacts" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "cost_centers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cost_centers" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='cost_centers' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "cost_centers" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "coupon_codes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "coupon_codes" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='coupon_codes' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "coupon_codes" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "courses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "courses" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='courses' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "courses" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "crm_activities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_activities" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='crm_activities' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "crm_activities" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "crm_processes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_processes" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='crm_processes' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "crm_processes" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "crm_target_actuals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_target_actuals" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='crm_target_actuals' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "crm_target_actuals" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "crm_targets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_targets" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='crm_targets' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "crm_targets" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "crop_activities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crop_activities" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='crop_activities' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "crop_activities" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "crop_cycles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crop_cycles" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='crop_cycles' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "crop_cycles" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "ctcs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ctcs" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='ctcs' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "ctcs" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "currencies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "currencies" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='currencies' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "currencies" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "custom_fields" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "custom_fields" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='custom_fields' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "custom_fields" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "customer_groups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customer_groups" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='customer_groups' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "customer_groups" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "daily_worksheets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "daily_worksheets" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='daily_worksheets' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "daily_worksheets" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "dashboard_bookmarks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "dashboard_bookmarks" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='dashboard_bookmarks' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "dashboard_bookmarks" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "dashboards" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "dashboards" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='dashboards' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "dashboards" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "data_retention_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "data_retention_policies" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='data_retention_policies' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "data_retention_policies" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "data_subject_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "data_subject_requests" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='data_subject_requests' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "data_subject_requests" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "deferred_revenue_schedules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "deferred_revenue_schedules" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='deferred_revenue_schedules' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "deferred_revenue_schedules" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "delivery_notes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "delivery_notes" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='delivery_notes' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "delivery_notes" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "delivery_trips" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "delivery_trips" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='delivery_trips' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "delivery_trips" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "desk_assignment_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "desk_assignment_rules" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='desk_assignment_rules' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "desk_assignment_rules" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "desk_canned_responses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "desk_canned_responses" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='desk_canned_responses' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "desk_canned_responses" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "desk_sla_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "desk_sla_policies" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='desk_sla_policies' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "desk_sla_policies" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "desk_tickets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "desk_tickets" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='desk_tickets' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "desk_tickets" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "digest_schedules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "digest_schedules" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='digest_schedules' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "digest_schedules" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "doc_subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "doc_subscriptions" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='doc_subscriptions' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "doc_subscriptions" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "donations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "donations" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='donations' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "donations" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "donors" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "donors" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='donors' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "donors" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "duplicate_merges" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "duplicate_merges" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='duplicate_merges' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "duplicate_merges" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "duplicate_reviews" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "duplicate_reviews" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='duplicate_reviews' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "duplicate_reviews" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "editorial_notes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "editorial_notes" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='editorial_notes' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "editorial_notes" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "email_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "email_messages" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='email_messages' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "email_messages" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "email_sequences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "email_sequences" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='email_sequences' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "email_sequences" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "email_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "email_templates" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='email_templates' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "email_templates" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "embeddings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "embeddings" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='embeddings' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "embeddings" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "employee_advances" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "employee_advances" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='employee_advances' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "employee_advances" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "employee_categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "employee_categories" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='employee_categories' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "employee_categories" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "employee_certifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "employee_certifications" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='employee_certifications' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "employee_certifications" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "employee_checkins" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "employee_checkins" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='employee_checkins' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "employee_checkins" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "employee_checklist_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "employee_checklist_templates" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='employee_checklist_templates' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "employee_checklist_templates" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "employee_checklists" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "employee_checklists" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='employee_checklists' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "employee_checklists" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "employee_ctcs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "employee_ctcs" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='employee_ctcs' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "employee_ctcs" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "employee_grades" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "employee_grades" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='employee_grades' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "employee_grades" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "employee_onboardings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "employee_onboardings" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='employee_onboardings' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "employee_onboardings" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "employee_separations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "employee_separations" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='employee_separations' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "employee_separations" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "employee_skills" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "employee_skills" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='employee_skills' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "employee_skills" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "employees" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "employees" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='employees' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "employees" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "employment_types" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "employment_types" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='employment_types' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "employment_types" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "error_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "error_logs" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='error_logs' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "error_logs" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "esic_details" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "esic_details" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='esic_details' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "esic_details" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "etds_details" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "etds_details" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='etds_details' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "etds_details" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "eway_bills" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "eway_bills" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='eway_bills' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "eway_bills" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "exchange_rates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "exchange_rates" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='exchange_rates' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "exchange_rates" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "expense_claim_types" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "expense_claim_types" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='expense_claim_types' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "expense_claim_types" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "expense_claims" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "expense_claims" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='expense_claims' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "expense_claims" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "export_presets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "export_presets" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='export_presets' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "export_presets" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "feature_flags" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "feature_flags" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='feature_flags' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "feature_flags" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "fee_postings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fee_postings" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='fee_postings' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "fee_postings" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "fee_schedules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fee_schedules" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='fee_schedules' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "fee_schedules" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "final_settlements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "final_settlements" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='final_settlements' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "final_settlements" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "fiscal_years" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fiscal_years" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='fiscal_years' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "fiscal_years" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "form_12bb" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "form_12bb" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='form_12bb' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "form_12bb" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "form_16" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "form_16" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='form_16' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "form_16" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "fx_revaluation_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fx_revaluation_runs" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='fx_revaluation_runs' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "fx_revaluation_runs" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "grants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "grants" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='grants' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "grants" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "holiday_lists" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "holiday_lists" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='holiday_lists' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "holiday_lists" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "house_rent_details" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "house_rent_details" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='house_rent_details' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "house_rent_details" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "idempotency_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "idempotency_keys" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='idempotency_keys' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "idempotency_keys" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "import_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "import_jobs" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='import_jobs' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "import_jobs" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "integration_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "integration_events" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='integration_events' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "integration_events" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "intercompany_journals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "intercompany_journals" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='intercompany_journals' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "intercompany_journals" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "invoice_payment_schedules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoice_payment_schedules" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='invoice_payment_schedules' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "invoice_payment_schedules" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "inward_outward_notes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inward_outward_notes" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='inward_outward_notes' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "inward_outward_notes" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "issues" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "issues" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='issues' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "issues" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "item_alternates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "item_alternates" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='item_alternates' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "item_alternates" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "item_prices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "item_prices" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='item_prices' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "item_prices" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "item_reorder_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "item_reorder_rules" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='item_reorder_rules' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "item_reorder_rules" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "item_site_plannings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "item_site_plannings" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='item_site_plannings' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "item_site_plannings" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "item_uom_conversions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "item_uom_conversions" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='item_uom_conversions' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "item_uom_conversions" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "items" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='items' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "items" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "job_applicants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "job_applicants" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='job_applicants' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "job_applicants" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "job_cards" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "job_cards" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='job_cards' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "job_cards" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "job_openings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "job_openings" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='job_openings' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "job_openings" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "journal_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "journal_entries" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='journal_entries' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "journal_entries" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "journey_enrollments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "journey_enrollments" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='journey_enrollments' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "journey_enrollments" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "kb_articles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "kb_articles" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='kb_articles' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "kb_articles" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "kb_categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "kb_categories" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='kb_categories' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "kb_categories" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "land_units" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "land_units" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='land_units' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "land_units" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "landed_cost_vouchers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "landed_cost_vouchers" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='landed_cost_vouchers' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "landed_cost_vouchers" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "landing_pages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "landing_pages" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='landing_pages' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "landing_pages" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "lead_score_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lead_score_rules" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='lead_score_rules' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "lead_score_rules" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "leads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leads" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='leads' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "leads" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "learn_certificates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "learn_certificates" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='learn_certificates' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "learn_certificates" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "learn_courses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "learn_courses" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='learn_courses' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "learn_courses" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "learn_enrollments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "learn_enrollments" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='learn_enrollments' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "learn_enrollments" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "leave_allocations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leave_allocations" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='leave_allocations' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "leave_allocations" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "leave_applications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leave_applications" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='leave_applications' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "leave_applications" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "leave_encashments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leave_encashments" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='leave_encashments' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "leave_encashments" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "leave_ledger_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leave_ledger_entries" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='leave_ledger_entries' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "leave_ledger_entries" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "leave_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leave_policies" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='leave_policies' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "leave_policies" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "leave_types" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leave_types" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='leave_types' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "leave_types" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "letterheads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "letterheads" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='letterheads' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "letterheads" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "letters_of_credit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "letters_of_credit" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='letters_of_credit' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "letters_of_credit" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "list_views" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "list_views" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='list_views' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "list_views" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "loan_types" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "loan_types" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='loan_types' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "loan_types" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "loans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "loans" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='loans' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "loans" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "location_captures" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "location_captures" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='location_captures' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "location_captures" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "loyalty_point_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "loyalty_point_entries" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='loyalty_point_entries' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "loyalty_point_entries" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "loyalty_programs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "loyalty_programs" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='loyalty_programs' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "loyalty_programs" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "lwf_details" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lwf_details" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='lwf_details' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "lwf_details" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "machine_loggers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "machine_loggers" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='machine_loggers' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "machine_loggers" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "maintenance_actions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "maintenance_actions" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='maintenance_actions' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "maintenance_actions" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "maintenance_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "maintenance_requests" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='maintenance_requests' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "maintenance_requests" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "maintenance_schedules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "maintenance_schedules" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='maintenance_schedules' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "maintenance_schedules" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "marketing_approvals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "marketing_approvals" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='marketing_approvals' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "marketing_approvals" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "marketing_journeys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "marketing_journeys" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='marketing_journeys' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "marketing_journeys" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "material_issues" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "material_issues" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='material_issues' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "material_issues" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "material_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "material_requests" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='material_requests' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "material_requests" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "material_returns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "material_returns" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='material_returns' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "material_returns" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "material_transfers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "material_transfers" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='material_transfers' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "material_transfers" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "media_assets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "media_assets" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='media_assets' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "media_assets" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "meeting_types" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "meeting_types" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='meeting_types' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "meeting_types" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='memberships' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "memberships" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "milestones" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "milestones" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='milestones' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "milestones" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "mrp_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mrp_runs" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='mrp_runs' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "mrp_runs" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "naming_series_counters" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "naming_series_counters" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='naming_series_counters' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "naming_series_counters" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "non_conformances" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "non_conformances" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='non_conformances' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "non_conformances" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "notebooks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notebooks" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='notebooks' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "notebooks" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "notes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notes" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='notes' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "notes" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "notification_preferences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notification_preferences" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='notification_preferences' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "notification_preferences" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='notifications' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "notifications" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "oauth_clients" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "oauth_clients" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='oauth_clients' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "oauth_clients" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "opportunities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "opportunities" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='opportunities' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "opportunities" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "outside_payroll_details" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outside_payroll_details" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='outside_payroll_details' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "outside_payroll_details" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "overtime_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "overtime_requests" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='overtime_requests' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "overtime_requests" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "patient_appointments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "patient_appointments" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='patient_appointments' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "patient_appointments" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "patient_encounters" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "patient_encounters" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='patient_encounters' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "patient_encounters" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "patients" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "patients" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='patients' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "patients" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "pay_codes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pay_codes" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='pay_codes' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "pay_codes" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "payable_days" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payable_days" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='payable_days' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "payable_days" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "payment_reminders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_reminders" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='payment_reminders' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "payment_reminders" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "payment_terms_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_terms_templates" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='payment_terms_templates' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "payment_terms_templates" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "payroll_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payroll_entries" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='payroll_entries' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "payroll_entries" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "pf_details" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pf_details" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='pf_details' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "pf_details" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "pick_lists" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pick_lists" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='pick_lists' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "pick_lists" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "pipeline_blueprints" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pipeline_blueprints" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='pipeline_blueprints' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "pipeline_blueprints" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "portal_invites" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "portal_invites" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='portal_invites' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "portal_invites" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "portal_tickets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "portal_tickets" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='portal_tickets' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "portal_tickets" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "portal_users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "portal_users" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='portal_users' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "portal_users" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "pos_closing_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pos_closing_entries" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='pos_closing_entries' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "pos_closing_entries" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "pos_opening_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pos_opening_entries" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='pos_opening_entries' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "pos_opening_entries" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "pos_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pos_profiles" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='pos_profiles' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "pos_profiles" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "prescriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "prescriptions" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='prescriptions' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "prescriptions" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "previous_employer_details" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "previous_employer_details" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='previous_employer_details' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "previous_employer_details" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "price_lists" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "price_lists" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='price_lists' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "price_lists" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "pricing_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pricing_rules" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='pricing_rules' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "pricing_rules" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "print_formats" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "print_formats" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='print_formats' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "print_formats" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "production_plans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "production_plans" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='production_plans' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "production_plans" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "professional_tax_details" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "professional_tax_details" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='professional_tax_details' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "professional_tax_details" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "programs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "programs" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='programs' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "programs" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "project_plannings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "project_plannings" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='project_plannings' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "project_plannings" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "project_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "project_templates" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='project_templates' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "project_templates" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "projects" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "projects" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='projects' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "projects" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "purchase_invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purchase_invoices" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='purchase_invoices' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "purchase_invoices" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "purchase_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purchase_orders" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='purchase_orders' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "purchase_orders" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "purchase_receipts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purchase_receipts" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='purchase_receipts' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "purchase_receipts" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "purchase_warranties" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purchase_warranties" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='purchase_warranties' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "purchase_warranties" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "quality_inspection_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quality_inspection_templates" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='quality_inspection_templates' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "quality_inspection_templates" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "quality_inspections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quality_inspections" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='quality_inspections' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "quality_inspections" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "quotations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quotations" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='quotations' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "quotations" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "recurring_invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recurring_invoices" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='recurring_invoices' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "recurring_invoices" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "report_bookmarks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "report_bookmarks" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='report_bookmarks' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "report_bookmarks" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "repost_item_valuations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "repost_item_valuations" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='repost_item_valuations' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "repost_item_valuations" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "request_for_quotations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "request_for_quotations" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='request_for_quotations' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "request_for_quotations" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='role_permissions' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "role_permissions" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='roles' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "roles" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "room_bookings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "room_bookings" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='room_bookings' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "room_bookings" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "rooms" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rooms" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='rooms' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "rooms" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "routing_masters" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "routing_masters" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='routing_masters' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "routing_masters" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "running_timers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "running_timers" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='running_timers' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "running_timers" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "salary_jvs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "salary_jvs" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='salary_jvs' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "salary_jvs" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "salary_structures" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "salary_structures" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='salary_structures' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "salary_structures" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "sales_enquiries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sales_enquiries" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='sales_enquiries' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "sales_enquiries" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "sales_invoice_sales_person_allocations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sales_invoice_sales_person_allocations" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='sales_invoice_sales_person_allocations' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "sales_invoice_sales_person_allocations" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "sales_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sales_orders" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='sales_orders' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "sales_orders" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "sales_persons" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sales_persons" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='sales_persons' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "sales_persons" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "saved_reports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "saved_reports" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='saved_reports' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "saved_reports" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "savings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "savings" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='savings' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "savings" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "scheduled_reports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "scheduled_reports" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='scheduled_reports' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "scheduled_reports" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "sequence_enrollments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sequence_enrollments" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='sequence_enrollments' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "sequence_enrollments" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "serial_numbers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "serial_numbers" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='serial_numbers' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "serial_numbers" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "service_contracts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "service_contracts" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='service_contracts' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "service_contracts" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "shift_types" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "shift_types" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='shift_types' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "shift_types" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "shipment_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "shipment_events" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='shipment_events' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "shipment_events" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "shipments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "shipments" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='shipments' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "shipments" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "signature_envelopes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "signature_envelopes" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='signature_envelopes' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "signature_envelopes" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "signature_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "signature_requests" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='signature_requests' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "signature_requests" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "siq_chat_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "siq_chat_sessions" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='siq_chat_sessions' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "siq_chat_sessions" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "siq_visitors" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "siq_visitors" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='siq_visitors' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "siq_visitors" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "siq_widget_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "siq_widget_settings" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='siq_widget_settings' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "siq_widget_settings" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "sms_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sms_messages" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='sms_messages' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "sms_messages" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "sms_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sms_templates" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='sms_templates' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "sms_templates" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "social_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "social_accounts" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='social_accounts' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "social_accounts" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "social_mentions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "social_mentions" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='social_mentions' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "social_mentions" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "social_monitors" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "social_monitors" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='social_monitors' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "social_monitors" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "social_posts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "social_posts" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='social_posts' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "social_posts" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "sso_providers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sso_providers" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='sso_providers' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "sso_providers" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "statutory_components" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "statutory_components" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='statutory_components' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "statutory_components" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "stock_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_entries" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='stock_entries' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "stock_entries" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "stock_ledger_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_ledger_entries" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='stock_ledger_entries' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "stock_ledger_entries" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "stock_reconciliations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_reconciliations" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='stock_reconciliations' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "stock_reconciliations" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "student_enrollments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "student_enrollments" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='student_enrollments' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "student_enrollments" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "students" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "students" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='students' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "students" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subscriptions" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='subscriptions' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "subscriptions" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "super_annuation_funds" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "super_annuation_funds" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='super_annuation_funds' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "super_annuation_funds" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "supplier_quotations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "supplier_quotations" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='supplier_quotations' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "supplier_quotations" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "supplier_scorecards" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "supplier_scorecards" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='supplier_scorecards' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "supplier_scorecards" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "suppliers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "suppliers" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='suppliers' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "suppliers" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "suppressions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "suppressions" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='suppressions' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "suppressions" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "survey_responses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "survey_responses" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='survey_responses' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "survey_responses" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "surveys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "surveys" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='surveys' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "surveys" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "tasks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tasks" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='tasks' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "tasks" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "tax_collection_categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tax_collection_categories" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='tax_collection_categories' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "tax_collection_categories" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "tax_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tax_templates" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='tax_templates' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "tax_templates" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "tax_withholding_categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tax_withholding_categories" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='tax_withholding_categories' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "tax_withholding_categories" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "tds_challans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tds_challans" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='tds_challans' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "tds_challans" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "tenant_integrations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_integrations" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='tenant_integrations' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "tenant_integrations" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "territories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "territories" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='territories' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "territories" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "timesheets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "timesheets" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='timesheets' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "timesheets" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "todos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "todos" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='todos' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "todos" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "tracking_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tracking_events" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='tracking_events' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "tracking_events" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "training_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "training_events" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='training_events' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "training_events" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "user_company_access" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_company_access" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='user_company_access' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "user_company_access" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='users' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "users" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "vehicle_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vehicle_logs" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='vehicle_logs' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "vehicle_logs" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "vehicles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vehicles" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='vehicles' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "vehicles" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "warehouses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "warehouses" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='warehouses' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "warehouses" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "warranties" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "warranties" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='warranties' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "warranties" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "web_form_submissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "web_form_submissions" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='web_form_submissions' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "web_form_submissions" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "web_forms" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "web_forms" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='web_forms' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "web_forms" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "web_pages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "web_pages" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='web_pages' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "web_pages" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "webhook_deliveries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "webhook_deliveries" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='webhook_deliveries' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "webhook_deliveries" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "webhook_subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "webhook_subscriptions" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='webhook_subscriptions' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "webhook_subscriptions" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "webinar_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "webinar_events" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='webinar_events' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "webinar_events" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "webinar_registrations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "webinar_registrations" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='webinar_registrations' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "webinar_registrations" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "website_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "website_items" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='website_items' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "website_items" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "weighments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "weighments" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='weighments' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "weighments" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "whatsapp_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "whatsapp_messages" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='whatsapp_messages' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "whatsapp_messages" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "whatsapp_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "whatsapp_templates" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='whatsapp_templates' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "whatsapp_templates" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "work_groups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "work_groups" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='work_groups' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "work_groups" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "work_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "work_items" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='work_items' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "work_items" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "work_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "work_orders" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='work_orders' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "work_orders" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "work_plans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "work_plans" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='work_plans' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "work_plans" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "workdrive_files" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workdrive_files" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='workdrive_files' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "workdrive_files" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "workdrive_folders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workdrive_folders" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='workdrive_folders' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "workdrive_folders" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "workdrive_share_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workdrive_share_links" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='workdrive_share_links' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "workdrive_share_links" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "workflows" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workflows" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='workflows' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "workflows" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;

ALTER TABLE "workstations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workstations" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='workstations' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON "workstations" USING (app_bypass_rls() OR "tenantId" = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR "tenantId" = app_current_tenant_id())';
  END IF;
END $$;
