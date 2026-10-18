-- Account-level brute-force lockout counters. Reset to 0 on successful login;
-- incremented per failed attempt. lockedUntil is set when the counter crosses
-- the threshold, and /auth/login refuses until now() > lockedUntil regardless
-- of per-IP rate-limit state.

ALTER TABLE "users"
  ADD COLUMN "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lockedUntil" TIMESTAMP(3);
