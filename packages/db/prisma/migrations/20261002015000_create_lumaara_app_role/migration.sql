-- Create the `lumaara_app` role before 20261002020000_platform_schema_poc,
-- which GRANTs to it. The role was originally introduced later, in
-- 20261004030000_lumaara_app_role, so `prisma migrate deploy` on a fresh
-- database failed with `role "lumaara_app" does not exist`.
--
-- Same role shape as 20261004030000 (which stays as-is and still applies
-- the public-schema grants). Idempotent — a no-op on databases where the
-- role already exists.

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
