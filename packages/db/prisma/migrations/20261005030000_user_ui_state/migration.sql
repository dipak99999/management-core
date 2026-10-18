-- Per-user UI state tables backing @lumaara/web-ui primitives.
--   user_list_views   — saved filter sets per list page (replaces localStorage)
--   user_form_defaults — remembered last values per form (replaces localStorage)
--   ai_rules           — "save-as-rule" snippets to replay AI corrections

CREATE TABLE "public"."user_list_views" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "listKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_list_views_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "user_list_views_tenantId_userId_listKey_idx"
  ON "public"."user_list_views"("tenantId", "userId", "listKey");

CREATE TABLE "public"."user_form_defaults" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "formKey" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_form_defaults_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_form_defaults_tenantId_userId_formKey_key"
  ON "public"."user_form_defaults"("tenantId", "userId", "formKey");

CREATE TABLE "public"."ai_rules" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_rules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_rules_tenantId_userId_scope_idx"
  ON "public"."ai_rules"("tenantId", "userId", "scope");
