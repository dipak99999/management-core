#!/usr/bin/env bash
# scripts/deploy.sh — Docker Compose production deployer with pre-flight.
#
# Walks through the production checklist from PRODUCTION.md:
#   1. Confirms .env.prod exists + chmod 600
#   2. Validates compose stack config (fails if any ${VAR:?err} is missing)
#   3. Checks database reachability
#   4. Pulls / builds images
#   5. Runs the migrate container (one-shot — blocks until migrations done)
#   6. Starts all services
#   7. Waits for every /health/ready to go green with a 90s timeout
#   8. Prints the status URL + rollback command
#
# Usage:
#   bash scripts/deploy.sh                 # deploy using .env.prod
#   bash scripts/deploy.sh --env <path>    # deploy using an alternate env file
#   bash scripts/deploy.sh --dry-run       # pre-flight only, no actual deploy
#   bash scripts/deploy.sh --rollback      # roll back to previous image via git tag
#
# This script is idempotent for success cases — rerunning after a successful
# deploy is a no-op (migrate container exits 0, services already running).
# For failure cases it exits early with a clear message so you can fix +
# retry.

set -euo pipefail

ENV_FILE=".env.prod"
DRY_RUN=0
ROLLBACK=0
COMPOSE_FILES="-f docker-compose.yml -f docker-compose.prod.yml"

while [ $# -gt 0 ]; do
  case "$1" in
    --env) ENV_FILE="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --rollback) ROLLBACK=1; shift ;;
    -h|--help)
      sed -n '2,30p' "$0" | sed 's/^# //; s/^#//'
      exit 0
      ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

color() { tput setaf "$1" 2>/dev/null; }
reset() { tput sgr0 2>/dev/null; }
ok()   { echo "$(color 2)✓$(reset) $*"; }
warn() { echo "$(color 3)⚠$(reset) $*"; }
err()  { echo "$(color 1)✗$(reset) $*" >&2; }
step() { echo; echo "$(color 4)[$1]$(reset) $2"; }

# ─── 1. Pre-flight: env file exists + locked down ─────────────────────
step "1/8" "Pre-flight checks"
if [ ! -f "$ENV_FILE" ]; then
  err "$ENV_FILE not found."
  echo "  Generate one with: bash scripts/generate-prod-secrets.sh > $ENV_FILE"
  echo "  Then fill in DATABASE_URL, ALLOWED_ORIGINS, SMTP_*, and legal values."
  exit 1
fi
PERMS=$(stat -f '%A' "$ENV_FILE" 2>/dev/null || stat -c '%a' "$ENV_FILE")
if [ "$PERMS" != "600" ]; then
  warn "$ENV_FILE has mode $PERMS — should be 600. Fixing."
  chmod 600 "$ENV_FILE"
fi
ok "env file: $ENV_FILE (mode 600)"

# ─── 2. Required binaries ────────────────────────────────────────────
for bin in docker; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    err "$bin not installed."
    exit 1
  fi
done
if ! docker compose version >/dev/null 2>&1; then
  err "'docker compose' subcommand missing (need Docker Compose v2)."
  exit 1
fi
ok "docker + docker compose available"

# ─── 3. Validate compose config (fails fast on missing ${VAR:?err}) ──
step "2/8" "Validating compose config"
set -o allexport; source "$ENV_FILE"; set +o allexport
if ! docker compose $COMPOSE_FILES config --quiet; then
  err "Compose config validation failed. See errors above — likely a missing required env var."
  exit 1
fi
ok "compose config validates"

# ─── 4. DB reachability ──────────────────────────────────────────────
step "3/8" "Database reachability"
if [ -z "${DATABASE_URL:-}" ]; then
  err "DATABASE_URL not set in $ENV_FILE"
  exit 1
fi
# Parse host + port from the URL. psql / pg_isready would be cleaner but
# we don't want to require them on the deploy host.
DB_HOST=$(echo "$DATABASE_URL" | sed -nE 's|^.*@([^:/]+)[:/].*$|\1|p')
DB_PORT=$(echo "$DATABASE_URL" | sed -nE 's|^.*@[^:]+:([0-9]+)/.*$|\1|p')
DB_PORT=${DB_PORT:-5432}
if command -v nc >/dev/null 2>&1; then
  if ! nc -z -w 5 "$DB_HOST" "$DB_PORT" 2>/dev/null; then
    err "Cannot reach $DB_HOST:$DB_PORT. Check network + firewall."
    exit 1
  fi
  ok "database reachable at $DB_HOST:$DB_PORT"
else
  warn "nc not installed — skipping DB reachability probe"
fi

# ─── 5. Dry-run exit point ───────────────────────────────────────────
if [ "$DRY_RUN" -eq 1 ]; then
  echo
  ok "Dry-run complete. All pre-flight checks passed."
  echo "   Rerun without --dry-run to actually deploy."
  exit 0
fi

# ─── 6. Rollback path (simple: previous docker tag) ──────────────────
if [ "$ROLLBACK" -eq 1 ]; then
  step "ROLLBACK" "Reverting to previous APP_VERSION"
  PREV=$(git rev-parse HEAD~1 --short 2>/dev/null || echo "")
  if [ -z "$PREV" ]; then
    err "Cannot determine previous git ref — aborting rollback."
    exit 1
  fi
  warn "This will set APP_VERSION=$PREV and docker compose up -d"
  echo "   You MUST have an image tagged $PREV already pushed to your registry."
  read -r -p "   Continue? [y/N] " yn
  [ "$yn" = "y" ] || { echo "aborted"; exit 0; }
  APP_VERSION="$PREV" docker compose $COMPOSE_FILES up -d
  ok "rolled back to $PREV"
  exit 0
fi

# ─── 7. Pull / build + migrate + start ───────────────────────────────
step "4/8" "Pulling + building images"
docker compose $COMPOSE_FILES build --pull
ok "images ready"

step "5/8" "Running migrations (one-shot)"
# The `migrate` service in docker-compose.prod.yml runs prisma migrate deploy
# then exits. --exit-code-from waits for it + propagates the exit code.
if ! docker compose $COMPOSE_FILES up --exit-code-from migrate migrate; then
  err "Migration run failed. See logs above. Fix the schema issue + retry."
  exit 1
fi
ok "migrations applied"

step "6/8" "Starting services"
docker compose $COMPOSE_FILES up -d
ok "services started"

# ─── 8. Wait for health ──────────────────────────────────────────────
step "7/8" "Waiting for health (90s timeout)"
PORTS=(4001 4002 4003 4004 4005 4006 4009 4110)
DEADLINE=$(( $(date +%s) + 90 ))
pending=("${PORTS[@]}")
while [ ${#pending[@]} -gt 0 ] && [ "$(date +%s)" -lt "$DEADLINE" ]; do
  still=()
  for p in "${pending[@]}"; do
    if curl -sf --max-time 2 "http://localhost:$p/health/ready" >/dev/null 2>&1; then
      ok "service on :$p ready"
    else
      still+=("$p")
    fi
  done
  pending=("${still[@]}")
  [ ${#pending[@]} -gt 0 ] && sleep 2
done
if [ ${#pending[@]} -gt 0 ]; then
  err "Services still not ready after 90s: ${pending[*]}"
  echo "   Check logs: docker compose $COMPOSE_FILES logs --tail=100 <service-name>"
  exit 1
fi

step "8/8" "Smoke tests"
if curl -sf --max-time 5 http://localhost:4556/api/status | grep -q '"ok":true'; then
  ok "aggregated status: all green"
else
  warn "status page reports degraded services — check /status in browser"
fi

echo
ok "Deploy complete."
echo
echo "   Status page:    http://localhost:4556/status"
echo "   Audit logs:     http://localhost:4556/admin/audit-logs"
echo "   Rollback:       bash scripts/deploy.sh --rollback"
echo "   Follow logs:    docker compose $COMPOSE_FILES logs -f"
