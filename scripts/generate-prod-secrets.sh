#!/usr/bin/env bash
# Generate a production .env with real, random secrets.
#
# Usage:
#   bash scripts/generate-prod-secrets.sh > .env.prod && chmod 600 .env.prod
#
# All secrets are 32-byte random hex (64 chars). The output is a complete
# .env file — you still need to fill in business values (POSTGRES_HOST,
# ALLOWED_ORIGINS, SMTP_*, OTEL_EXPORTER_OTLP_ENDPOINT) at the bottom.
#
# WARNINGS the operator must heed:
#   1. BACK UP MASTER_SECRET_KEY OFFSITE. Losing it bricks every
#      encrypted secret in TenantIntegration + PlatformAiProvider +
#      PlatformBillingGateway + AnonymizationArchive. Store it in your
#      org's vault + a sealed envelope.
#   2. Rotating JWT_SECRET invalidates every active user session.
#      Users must re-login. Not a bug — expected behaviour.
#   3. Rotating PORTAL_JWT_SECRET invalidates portal (customer-facing)
#      sessions.
#   4. Rotating UNSUBSCRIBE_SECRET breaks any already-sent unsubscribe
#      email links. Rotate only when necessary.
#   5. Rotating MASTER_SECRET_KEY requires running
#      scripts/rotate-master-secret.ts first — otherwise you cannot
#      decrypt existing rows.
#
# Script is idempotent in the trivial sense (regenerating overwrites),
# but each call produces DIFFERENT values — don't re-run against a
# running system without a rotation plan.

set -euo pipefail

if ! command -v openssl >/dev/null 2>&1; then
  echo "ERROR: openssl not installed. Install with: brew install openssl / apt-get install openssl" >&2
  exit 1
fi

gen() {
  openssl rand -hex 32
}

cat << ENV_EOF
# ─────────────────────────────────────────────────────────────────────
# Lumaara ERP — production environment
# Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)
# ─────────────────────────────────────────────────────────────────────
#
# BACK UP MASTER_SECRET_KEY SOMEWHERE OFFSITE BEFORE DEPLOYING.
# Losing it = permanent data loss on all encrypted rows.
#
# chmod 600 this file. Treat as more sensitive than database backups.
# Rotate per PRODUCTION.md § Secret rotation.
#
NODE_ENV=production

# ── Database — set hostname + credentials for your prod Postgres ─────
# Prod services should connect as lumaara_app (NOSUPERUSER + NOBYPASSRLS)
# so RLS enforces. Create the role + password with:
#   CREATE USER lumaara_app PASSWORD '<openssl rand -hex 24>'
#     NOSUPERUSER NOBYPASSRLS;
# Then put that URL here. DATABASE_ADMIN_URL stays as the superuser so
# \`prisma migrate deploy\` can run DDL.
DATABASE_URL=postgresql://lumaara_app:CHANGE_ME@db.example.com:5432/lumaara?schema=public
DATABASE_ADMIN_URL=postgresql://postgres:CHANGE_ME@db.example.com:5432/lumaara?schema=public

# ── Secrets (REAL — do NOT commit this file) ─────────────────────────
JWT_SECRET=$(gen)
JWT_EXPIRES_IN=7d
PORTAL_JWT_SECRET=$(gen)
UNSUBSCRIBE_SECRET=$(gen)
MASTER_SECRET_KEY=$(gen)
SCHEDULER_API_TOKEN=$(gen)

# ── Public URLs — set to your real domains ───────────────────────────
PUBLIC_URL=https://erp.example.com
PORTAL_PUBLIC_URL=https://portal.example.com
PUBLIC_AUTH_URL=https://api.example.com
NEXT_PUBLIC_AUTH_SERVICE_URL=https://api.example.com
NEXT_PUBLIC_ACCOUNTING_SERVICE_URL=https://api.example.com
NEXT_PUBLIC_STOCK_SERVICE_URL=https://api.example.com
NEXT_PUBLIC_CRM_SERVICE_URL=https://api.example.com
NEXT_PUBLIC_HR_SERVICE_URL=https://api.example.com
NEXT_PUBLIC_PROJECTS_SERVICE_URL=https://api.example.com

# ── Shell → remote microfrontends (internal cluster addresses) ──────
ACCOUNTING_WEB_URL=http://accounting-web:3001
BUYING_WEB_URL=http://buying-web:3002
STOCK_WEB_URL=http://stock-web:3003
CRM_WEB_URL=http://crm-web:3004
HR_WEB_URL=http://hr-web:3005
PROJECTS_WEB_URL=http://projects-web:3006

# ── CORS — REQUIRED in prod. Services refuse to boot without this ───
ALLOWED_ORIGINS=https://erp.example.com,https://portal.example.com

# ── Tenant isolation ─────────────────────────────────────────────────
# Flip to "enforce" after a staging soak (watch "warn" logs for
# violations first). RLS_ENFORCE=true activates DB-layer RLS on top of
# the Prisma tenant-guard. See PRODUCTION.md.
TENANT_GUARD_MODE=warn
RLS_ENFORCE=false

# ── Queue + rate-limit backend ───────────────────────────────────────
REDIS_URL=redis://redis.example.com:6379

# ── Observability ────────────────────────────────────────────────────
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
APP_VERSION=$(git -C "$(dirname "$0")/.." rev-parse --short HEAD 2>/dev/null || echo "unknown")
LOG_LEVEL=info
# SENTRY_DSN=https://<key>@o<org>.ingest.sentry.io/<project>

# ── SMTP (transactional email) ───────────────────────────────────────
# Required for password resets, email verification, digests.
SMTP_HOST=email-smtp.us-east-1.amazonaws.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=no-reply@example.com

# ── Legal (customer-visible on /legal/* pages) ───────────────────────
LEGAL_COMPANY_NAME=
LEGAL_COMPANY_ADDRESS=
LEGAL_PRIVACY_EMAIL=privacy@example.com
LEGAL_LEGAL_EMAIL=legal@example.com
LEGAL_SUPPORT_EMAIL=support@example.com
LEGAL_JURISDICTION=
LEGAL_DATA_REGION=
ENV_EOF
