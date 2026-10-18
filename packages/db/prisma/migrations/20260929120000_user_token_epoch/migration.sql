-- Add tokenEpoch to users. Any JWT/session with iat < tokenEpoch is rejected
-- by requireAuth — password-change / reset / admin-forced re-auth bumps it,
-- so a stolen token stops working immediately on credential rotation.
--
-- Default `now()` on existing rows keeps them logged in; only tokens issued
-- BEFORE the migration applied would be invalidated, which is a safe
-- posture (worst-case a user re-logs in once). Prisma's default @default(now())
-- doesn't add the DB-level default on ALTER, so we set it here directly.

ALTER TABLE "users"
  ADD COLUMN "tokenEpoch" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "portal_users"
  ADD COLUMN "tokenEpoch" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
