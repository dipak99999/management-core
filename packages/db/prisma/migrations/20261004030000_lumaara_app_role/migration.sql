-- Create the `lumaara_app` DB role idempotently. Services switch to
-- connecting as this role (instead of the postgres superuser) once the
-- operator flips RLS_ENFORCE=true + rotates DATABASE_URL per PRODUCTION.md.
--
-- The role is created WITHOUT a password here — Postgres doesn't support
-- env substitution in migrations, and committing a password to version
-- control is obviously wrong. After this migration applies, the operator
-- rotates the password via `rotate-lumaara-app-password.sh` (or ALTER USER
-- directly) and stores it in the secret vault. Until the password is set,
-- lumaara_app CANNOT log in (NOLOGIN effectively — a password-less role
-- rejects every connection attempt), so this migration is safe to apply
-- without disruption: the superuser still owns the runtime connection.
--
-- Idempotent — safe to re-run. Uses DO $$ because CREATE ROLE lacks IF
-- NOT EXISTS and the referenced grants need to apply either way.
--
-- Role shape:
--   NOSUPERUSER   can't ALTER SYSTEM, can't bypass authz.
--   NOBYPASSRLS   RLS policies apply (the whole point).
--   LOGIN         can be used as a connection role.
--   NOCREATEDB    least privilege.
--   NOCREATEROLE  least privilege.
--   NOREPLICATION least privilege.
--
-- Role is intentionally NOT given ownership of any table. Writes go
-- through the GRANT below. ALTER TABLE / DROP / schema DDL stays with
-- the postgres superuser; prod migrations run with DATABASE_ADMIN_URL.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lumaara_app') THEN
    CREATE ROLE lumaara_app
      WITH LOGIN
           NOSUPERUSER
           NOBYPASSRLS
           NOCREATEDB
           NOCREATEROLE
           NOREPLICATION;
  END IF;
END
$$;

-- Grants on the public schema. These are additive to any grants from
-- 20261002020000_platform_schema_poc (platform schema has its own grants).
-- Writes needed: SELECT, INSERT, UPDATE, DELETE on every table. Sequences
-- needed for autoincrement + Prisma's cuid defaults (which are
-- application-side but any serial column needs USAGE + SELECT).
GRANT USAGE ON SCHEMA public TO lumaara_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO lumaara_app;
GRANT USAGE, SELECT                 ON ALL SEQUENCES IN SCHEMA public TO lumaara_app;
GRANT EXECUTE                       ON ALL FUNCTIONS IN SCHEMA public TO lumaara_app;

-- Default privileges for tables created in the future (every Prisma
-- migration going forward). Without this, lumaara_app would need a
-- manual GRANT after each migration adds a table.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES    TO lumaara_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT                  ON SEQUENCES TO lumaara_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE                        ON FUNCTIONS TO lumaara_app;
