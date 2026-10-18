#!/usr/bin/env bash
# Generate a strong password for the `lumaara_app` DB role, apply it, and
# print the DATABASE_URL the services should use.
#
# The role itself was created by migration 20261004030000_lumaara_app_role
# with no password — so until this script runs, the role cannot log in and
# existing superuser connections remain the only connection path.
#
# Usage (admin env must point at a superuser URL, same shape as
# DATABASE_ADMIN_URL in docker-compose.prod.yml):
#
#   DATABASE_ADMIN_URL=postgresql://postgres:${PG_PW}@host:5432/lumaara \
#     bash scripts/rotate-lumaara-app-password.sh
#
# Output: new DATABASE_URL on stdout, nothing else. Pipe into your secret
# vault or redirect into a prod env file:
#
#   bash scripts/rotate-lumaara-app-password.sh > /tmp/new-db-url
#   # ...feed that into your orchestrator's secret store...
#   shred /tmp/new-db-url
#
# This is idempotent in the sense that it can be re-run to rotate — each
# call generates a new password and ALTER USERs the role to use it.
# ALL active lumaara_app sessions will be invalidated at the DB level
# only after the server rotates its connection pool (connections already
# open with the old password keep working until they're closed/evicted).
#
# After rotating:
#   1. Deploy with the new DATABASE_URL on every service.
#   2. Set RLS_ENFORCE=true to activate the Prisma `withRlsExtension`
#      wrapper (see packages/db/src/rls-context.ts). Services then wrap
#      every tenant-scoped query in a transaction that SET LOCALs
#      app.current_tenant_id, and the role's NOBYPASSRLS attribute
#      enforces the policy created in 20261002010000_rls_poc +
#      20261002050000_rls_all_tenant_tables.
#   3. Watch logs for `permission denied` errors — those point at routes
#      that bypass requireAuth (which installs runWithTenant) or
#      super-admin cross-tenant queries that need runAsSuperAdmin() +
#      withSuperAdmin().
#
# Rollback: unset RLS_ENFORCE and point DATABASE_URL back at the
# superuser role. The role itself can be dropped with
# `DROP ROLE lumaara_app` (first REASSIGN OWNED BY lumaara_app TO
# postgres if anything was created under it, which should not have
# happened).

set -euo pipefail

if [ -z "${DATABASE_ADMIN_URL:-}" ]; then
  echo "ERROR: DATABASE_ADMIN_URL must be set (superuser connection string)." >&2
  echo "Example: DATABASE_ADMIN_URL=postgresql://postgres:xxx@host:5432/lumaara" >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "ERROR: psql not installed. Install with: brew install libpq / apt-get install postgresql-client" >&2
  exit 1
fi

NEW_PW=$(openssl rand -hex 24)

# Role must exist — migration 20261004030000 creates it idempotently.
# This script fails loud if someone's run it on a DB that skipped the
# migration (e.g., pointed at the wrong schema).
EXISTS=$(psql "$DATABASE_ADMIN_URL" -tAc "SELECT 1 FROM pg_roles WHERE rolname = 'lumaara_app'")
if [ "$EXISTS" != "1" ]; then
  echo "ERROR: role lumaara_app does not exist. Run 'prisma migrate deploy' first." >&2
  exit 1
fi

psql "$DATABASE_ADMIN_URL" -c "ALTER USER lumaara_app WITH PASSWORD '${NEW_PW}'" >/dev/null

# Rebuild a DATABASE_URL from the admin URL, swapping user+password only.
# Pattern-match: postgresql://<u>:<p>@<rest>. Keep schema/db/args suffix.
REST=${DATABASE_ADMIN_URL#*@}
echo "postgresql://lumaara_app:${NEW_PW}@${REST}"
