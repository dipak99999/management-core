-- Per-user AI Inbox preferences: category mute list + daily email digest opt-in.
CREATE TABLE "ai_inbox_preferences" (
  "id"               TEXT        NOT NULL,
  "tenantId"         TEXT        NOT NULL,
  "userId"           TEXT        NOT NULL,
  "mutedCategories"  TEXT[]      NOT NULL DEFAULT ARRAY[]::TEXT[],
  "dailyDigest"      BOOLEAN     NOT NULL DEFAULT false,
  "digestMinSeverity" TEXT        NOT NULL DEFAULT 'watch',
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_inbox_preferences_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_inbox_preferences_tenantId_fkey" FOREIGN KEY ("tenantId")
    REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ai_inbox_preferences_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ai_inbox_preferences_userId_key" ON "ai_inbox_preferences" ("userId");
CREATE INDEX "ai_inbox_preferences_tenantId_dailyDigest_idx" ON "ai_inbox_preferences" ("tenantId", "dailyDigest");
