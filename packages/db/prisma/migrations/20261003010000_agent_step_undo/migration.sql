-- Agent action timeline + undo. Adds nullable columns to agent_steps so
-- an undone action can be hidden from the recent-actions timeline and so
-- we have an auditable record of who undid it.
ALTER TABLE "agent_steps"
  ADD COLUMN "undoneAt" TIMESTAMP(3),
  ADD COLUMN "undoneByUserEmail" TEXT;

CREATE INDEX "agent_steps_tenantId_undoneAt_finishedAt_idx"
  ON "agent_steps" ("tenantId", "undoneAt", "finishedAt");
