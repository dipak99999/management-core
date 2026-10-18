-- Redo for undone agent actions. Nullable additive columns — safe to deploy.
ALTER TABLE "agent_steps"
  ADD COLUMN "redoneAt"          TIMESTAMP(3),
  ADD COLUMN "redoneByUserEmail" TEXT,
  ADD COLUMN "redoneOutputJson"  JSONB;
