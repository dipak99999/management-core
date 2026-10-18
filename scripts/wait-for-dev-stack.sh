#!/usr/bin/env bash
# Dev-mode counterpart of wait-for-stack.sh.
#
# `pnpm dev` runs every service + web app in parallel. Each one prints
# "listening on :4001" at a different time; first requests often race the
# slowest process (Next.js dev-mode first-compile = ~30s). This script
# polls every port's readiness probe so the operator knows when the whole
# stack is actually usable.
#
# Usage:
#
#   pnpm dev           # spawns everything, returns immediately
#   pnpm dev:wait      # spawns everything AND blocks until ready, then
#                      # exits (handing stdin back to the shell with the
#                      # stack still running — press Ctrl-C to kill it)
#
# The ports match .env defaults (4001-4006 + 3000-3006). Override with
# SHELL_PORT etc. if you've relocated them.

set -eu

MAX_ATTEMPTS="${MAX_ATTEMPTS:-60}"
SLEEP_S="${SLEEP_S:-2}"

check() {
  local label=$1 url=$2
  local i=0
  printf "waiting for %-20s" "$label"
  while [ $i -lt $MAX_ATTEMPTS ]; do
    if curl -sf -o /dev/null --max-time 3 "$url"; then
      printf " \033[32m✓\033[0m (%ds)\n" $((i * SLEEP_S))
      return 0
    fi
    printf "."
    i=$((i + 1))
    sleep "$SLEEP_S"
  done
  printf " \033[31m✗\033[0m\n"
  echo "FAIL: $label did not become ready after $((MAX_ATTEMPTS * SLEEP_S))s"
  return 1
}

# Backend services — DB-probing readiness.
check "auth-service"       "http://localhost:${AUTH_SERVICE_PORT:-4001}/health/ready"
check "accounting-service" "http://localhost:${ACCOUNTING_SERVICE_PORT:-4002}/health/ready"
check "stock-service"      "http://localhost:${STOCK_SERVICE_PORT:-4003}/health/ready"
check "crm-service"        "http://localhost:${CRM_SERVICE_PORT:-4004}/health/ready"
check "hr-service"         "http://localhost:${HR_SERVICE_PORT:-4005}/health/ready"
check "projects-service"   "http://localhost:${PROJECTS_SERVICE_PORT:-4006}/health/ready"

# Frontends — root URL responds once Next.js finishes first-compile.
check "shell"           "http://localhost:${SHELL_PORT:-3000}/"
check "accounting-web"  "http://localhost:${ACCOUNTING_WEB_PORT:-3001}/accounting"
check "buying-web"      "http://localhost:${BUYING_WEB_PORT:-3002}/buying"
check "stock-web"       "http://localhost:${STOCK_WEB_PORT:-3003}/stock"
check "crm-web"         "http://localhost:${CRM_WEB_PORT:-3004}/crm"
check "hr-web"          "http://localhost:${HR_WEB_PORT:-3005}/hr"
check "projects-web"    "http://localhost:${PROJECTS_WEB_PORT:-3006}/projects"
check "portal-web"      "http://localhost:${PORTAL_WEB_PORT:-3007}/portal"

echo ""
echo "─────────────────────────────────────────────────────────────"
echo "✓ stack is ready — open http://localhost:${SHELL_PORT:-3000}"
echo "─────────────────────────────────────────────────────────────"
