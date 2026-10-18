-- Marketing P3 (Agent D): per-tenant "require marketing approval" flag.
-- When true, campaign / broadcast / social publish flows refuse to leave
-- Draft/Scheduled unless an active MarketingApproval (Approved, ≤30d old)
-- exists for the doc. Defaulted false so existing tenants see no behavior
-- change.

-- AlterTable
ALTER TABLE "tenants"
  ADD COLUMN "requireMarketingApproval" BOOLEAN NOT NULL DEFAULT false;
