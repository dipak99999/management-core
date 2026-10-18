#!/usr/bin/env bash
# Lumaara one-shot bootstrap.
#
# Takes a fresh clone to a working app with the demo tenant seeded,
# ready for `pnpm dev`. Idempotent — safe to re-run.
#
# Flow:
#   1. Pre-flight (Node >= 20, pnpm, Postgres)
#   2. Install dependencies
#   3. Provision .env from .env.example if missing
#   4. Start Postgres (Docker if available, else expect native)
#   5. Generate Prisma client + apply migrations
#   6. Seed base tenants (acme + demo) + demo masters (customers, items, 1 SI)
#   7. Validate: demo tenant + admin user exist
#
# Options:
#   --skip-install        skip `pnpm install`
#   --skip-postgres       assume Postgres already running on $DATABASE_URL
#   --prefer-native       use native Postgres even if Docker is available
#   --reset               drop + recreate the lumaara DB (DESTROYS DATA)
#   -h | --help           this help
#
# Target env:
#   Node 20+, pnpm 9+, and either Docker-with-compose OR a reachable
#   Postgres 14+ instance.
#
# After it finishes:
#   pnpm dev            # boots all 8 web apps + 8 services
#   Login: demo@lumaara.local / demo1234   (tenant slug: demo)

set -euo pipefail

cd "$(dirname "$0")/.."
REPO_ROOT="$PWD"

# ─── argument parse ────────────────────────────────────────────────────
SKIP_INSTALL=0
SKIP_POSTGRES=0
PREFER_NATIVE=0
RESET=0

while [ $# -gt 0 ]; do
  case "$1" in
    --skip-install)   SKIP_INSTALL=1; shift ;;
    --skip-postgres)  SKIP_POSTGRES=1; shift ;;
    --prefer-native)  PREFER_NATIVE=1; shift ;;
    --reset)          RESET=1; shift ;;
    -h|--help)
      sed -n '2,30p' "$0" | sed 's/^# //; s/^#//'
      exit 0
      ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

# ─── pretty output ─────────────────────────────────────────────────────
color() { tput setaf "$1" 2>/dev/null || true; }
reset() { tput sgr0 2>/dev/null || true; }
ok()    { echo "$(color 2)✓$(reset) $*"; }
warn()  { echo "$(color 3)⚠$(reset) $*"; }
err()   { echo "$(color 1)✗$(reset) $*" >&2; }
step()  { echo; echo "$(color 4)[$1]$(reset) $2"; }

# ─── 1. pre-flight ─────────────────────────────────────────────────────
step 1/7 "Pre-flight checks"

if ! command -v node >/dev/null; then
  err "Node is not installed. Install Node 20+ from https://nodejs.org"
  exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  err "Node $NODE_MAJOR detected; need 20+. Try: nvm install 20"
  exit 1
fi
ok "Node $(node -v)"

if ! command -v pnpm >/dev/null; then
  err "pnpm is not installed. Install with: npm install -g pnpm@9"
  exit 1
fi
ok "pnpm $(pnpm --version)"

# Postgres mode detection — docker > native, unless --prefer-native
POSTGRES_MODE=""
if [ "$SKIP_POSTGRES" -eq 1 ]; then
  POSTGRES_MODE="external"
elif [ "$PREFER_NATIVE" -eq 1 ]; then
  if command -v psql >/dev/null; then
    POSTGRES_MODE="native"
  else
    err "--prefer-native but psql not found. Install Postgres: brew install postgresql@16 || apt-get install postgresql"
    exit 1
  fi
elif command -v docker >/dev/null && docker compose version >/dev/null 2>&1; then
  POSTGRES_MODE="docker"
elif command -v psql >/dev/null; then
  POSTGRES_MODE="native"
else
  err "Need Docker (with compose) OR a native Postgres (psql). None found."
  err "Install Docker Desktop OR: brew install postgresql@16"
  exit 1
fi
ok "Postgres mode: $POSTGRES_MODE"

# ─── 2. install dependencies ───────────────────────────────────────────
if [ "$SKIP_INSTALL" -eq 1 ]; then
  step 2/7 "Skipping dependency install (--skip-install)"
else
  step 2/7 "Installing dependencies (pnpm install)"
  pnpm install --frozen-lockfile
  ok "dependencies installed"
fi

# ─── 3. provision .env ─────────────────────────────────────────────────
step 3/7 "Checking .env"
if [ ! -f .env ]; then
  if [ ! -f .env.example ]; then
    err ".env.example missing — can't seed defaults"
    exit 1
  fi
  cp .env.example .env
  ok ".env created from .env.example (edit to taste)"
else
  ok ".env already exists"
fi

# Load .env so DATABASE_URL is in scope for later steps.
set -a
# shellcheck disable=SC1091
source .env
set +a

: "${DATABASE_URL:?DATABASE_URL must be set in .env}"
: "${DATABASE_ADMIN_URL:=$DATABASE_URL}"
export DATABASE_URL DATABASE_ADMIN_URL

# ─── 4. start Postgres ─────────────────────────────────────────────────
case "$POSTGRES_MODE" in
  docker)
    step 4/7 "Starting Postgres via docker-compose"
    docker compose up -d postgres
    # Wait for ready
    for i in $(seq 1 30); do
      if docker compose exec -T postgres pg_isready -U lumaara >/dev/null 2>&1; then
        ok "Postgres ready (docker)"
        break
      fi
      [ "$i" -eq 30 ] && { err "Postgres never came up"; exit 1; }
      sleep 1
    done
    ;;
  native)
    step 4/7 "Checking native Postgres"
    PG_HOST="${PG_HOST:-localhost}"
    PG_PORT="${PG_PORT:-5432}"
    for i in $(seq 1 20); do
      if pg_isready -h "$PG_HOST" -p "$PG_PORT" >/dev/null 2>&1; then
        ok "Postgres responding on ${PG_HOST}:${PG_PORT}"
        break
      fi
      [ "$i" -eq 20 ] && {
        err "Native Postgres not reachable on ${PG_HOST}:${PG_PORT}"
        err "Start it with: brew services start postgresql@16 (macOS) or systemctl start postgresql (linux)"
        exit 1
      }
      sleep 1
    done
    ;;
  external)
    step 4/7 "--skip-postgres: assuming DATABASE_URL points at a running instance"
    ok "skipped Postgres provisioning"
    ;;
esac

# Optional destructive reset — only runs if the user explicitly asked
if [ "$RESET" -eq 1 ]; then
  warn "--reset: dropping + recreating database (DATA LOSS)"
  read -r -p "Type 'yes' to confirm: " confirm
  [ "$confirm" = "yes" ] || { err "Aborted"; exit 1; }
  pnpm --filter @lumaara/db exec prisma migrate reset --force --skip-seed
  ok "database reset"
fi

# ─── 5. prisma generate + migrate deploy ───────────────────────────────
step 5/7 "Generating Prisma client + applying migrations"
pnpm --filter @lumaara/db db:generate
pnpm --filter @lumaara/db db:deploy
ok "schema up to date ($(ls packages/db/prisma/migrations | wc -l | tr -d ' ') migrations applied)"

# ─── 6. seed data ──────────────────────────────────────────────────────
step 6/7 "Seeding base tenants + demo masters"
pnpm db:seed
ok "base tenants (acme + demo) seeded"
pnpm db:seed:demo
ok "demo masters (customers, suppliers, items, 1 sales invoice) seeded"

# ─── 7. validate ───────────────────────────────────────────────────────
step 7/7 "Validating seed"
VALIDATION="$(pnpm --filter @lumaara/db --silent exec tsx -e '
import { prisma } from "./src";
async function main() {
  const demo = await prisma.tenant.findUnique({ where: { slug: "demo" } });
  if (!demo) throw new Error("demo tenant missing");
  const user = await prisma.user.findUnique({
    where: { tenantId_email: { tenantId: demo.id, email: "demo@lumaara.local" } },
  });
  if (!user) throw new Error("demo admin missing");
  const cust = await prisma.customer.count({ where: { tenantId: demo.id } });
  const items = await prisma.item.count({ where: { tenantId: demo.id } });
  const sinv = await prisma.salesInvoice.count({ where: { tenantId: demo.id } });
  console.log("tenant=demo users=1 customers=" + cust + " items=" + items + " sales-invoices=" + sinv);
}
main().finally(() => prisma.$disconnect());
' 2>&1 | tail -1)"

if echo "$VALIDATION" | grep -q "tenant=demo"; then
  ok "$VALIDATION"
else
  err "Validation failed: $VALIDATION"
  exit 1
fi

echo
echo "$(color 2)━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━$(reset)"
echo "$(color 2)✓ Bootstrap complete$(reset)"
echo "$(color 2)━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━$(reset)"
echo
echo "  Next steps:"
echo "    1. pnpm dev                 # starts all 8 web apps + 8 services"
echo "    2. open http://localhost:4556"
echo "    3. log in: demo@lumaara.local / demo1234  (tenant: demo)"
echo
echo "  To wipe + reseed: bash scripts/bootstrap.sh --reset"
echo
