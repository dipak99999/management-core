#!/usr/bin/env bash
# Launches all Next.js frontends with shifted ports. Kill via
# `pkill -f "opennext-erp/apps"`. Uses `next dev -p <port>` directly to
# override the port hardcoded in each app's package.json dev script.
set -eu

ROOT="/Users/datacaffe.ai/ERP-OpenNext/opennext-erp"

# Watchpack polling: chokidar's fs.watch hits EMFILE across 8 concurrent
# Next dev servers even with ulimit -n = 1M. Falling back to polling. Adds
# a small CPU overhead vs fs.watch but keeps hot-reload working reliably.
# Boot-exercise found the failure mode: without polling, every app served
# the branded not-found page for every route because compilation never
# completed.
export WATCHPACK_POLLING=true
export CHOKIDAR_USEPOLLING=1

# Point every web app at the shifted backend service URLs.
export NEXT_PUBLIC_AUTH_SERVICE_URL="http://localhost:4101"
export NEXT_PUBLIC_ACCOUNTING_SERVICE_URL="http://localhost:4102"
export NEXT_PUBLIC_STOCK_SERVICE_URL="http://localhost:4103"
export NEXT_PUBLIC_CRM_SERVICE_URL="http://localhost:4104"
export NEXT_PUBLIC_HR_SERVICE_URL="http://localhost:4105"
export NEXT_PUBLIC_PROJECTS_SERVICE_URL="http://localhost:4106"
# Shell needs to know where to proxy each module app.
export ACCOUNTING_WEB_URL="http://localhost:3101"
export BUYING_WEB_URL="http://localhost:3102"
export STOCK_WEB_URL="http://localhost:3103"
export CRM_WEB_URL="http://localhost:3104"
export HR_WEB_URL="http://localhost:3105"
export PROJECTS_WEB_URL="http://localhost:3106"

start() {
  local name=$1 port=$2
  local dir="$ROOT/apps/$name"
  echo "starting $name on :$port"
  (cd "$dir" && pnpm exec next dev -p "$port") > "/tmp/lumaara-web-$name.log" 2>&1 &
}

start shell 3100
start accounting-web 3101
start buying-web 3102
start stock-web 3103
start crm-web 3104
start hr-web 3105
start projects-web 3106
start portal-web 3107
echo "all frontends launched. logs in /tmp/lumaara-web-*.log"
