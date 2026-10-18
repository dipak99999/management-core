#!/usr/bin/env bash
# Poll all backend /health/ready endpoints + frontend / URLs until they
# return 2xx (or timeout). Used by CI's e2e job so Playwright doesn't start
# racing dev-mode Next.js compiles that haven't finished bootstrapping.
#
# Total timeout ≈ 4 min per target (48 attempts × 5s). Dev-mode Next.js
# first-compile can take ~30s per app; we allow generous headroom.
set -eu

MAX_ATTEMPTS="${MAX_ATTEMPTS:-48}"
SLEEP_S="${SLEEP_S:-5}"

check() {
  local label=$1 url=$2
  local i=0
  echo -n "waiting for $label ($url) "
  while [ $i -lt $MAX_ATTEMPTS ]; do
    if curl -sf -o /dev/null --max-time 5 "$url"; then
      echo " ✓"
      return 0
    fi
    echo -n "."
    i=$((i + 1))
    sleep "$SLEEP_S"
  done
  echo " ✗"
  echo "FAIL: $label did not become ready after $((MAX_ATTEMPTS * SLEEP_S))s"
  return 1
}

# Backend services — /health/ready hits the DB probe so the app is fully wired.
check "auth-service"       "http://localhost:4101/health/ready"
check "accounting-service" "http://localhost:4102/health/ready"
check "stock-service"      "http://localhost:4103/health/ready"
check "crm-service"        "http://localhost:4104/health/ready"
check "hr-service"         "http://localhost:4105/health/ready"
check "projects-service"   "http://localhost:4106/health/ready"

# Frontends — hit the root URL. `next dev` responds with 200 or a redirect
# once compilation completes. curl -f follows redirects and treats 2xx as ok.
check "shell"           "http://localhost:3100/"
check "accounting-web"  "http://localhost:3101/accounting"
check "buying-web"      "http://localhost:3102/buying"
check "stock-web"       "http://localhost:3103/stock"
check "crm-web"         "http://localhost:3104/crm"
check "hr-web"          "http://localhost:3105/hr"
check "projects-web"    "http://localhost:3106/projects"
check "portal-web"      "http://localhost:3107/portal"

echo "all stack components ready"
