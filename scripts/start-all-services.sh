#!/usr/bin/env bash
# Launches all backend services with per-service PORT overrides. Each service
# writes to /tmp/lumaara-<name>.log. Kill via `pkill -f "opennext-erp/services"`
# (path on disk kept as ERP-OpenNext/opennext-erp; only the product name was
# renamed to Lumaara — the folder rename is deferred to avoid breaking every
# terminal / editor session already pinned to this path).
set -eu

ROOT="/Users/datacaffe.ai/ERP-OpenNext/opennext-erp"
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/lumaara?schema=public"
export JWT_SECRET="dev-only-local-secret-do-not-use-in-prod-9b3f2e"
export PORTAL_JWT_SECRET="dev-only-portal-secret-do-not-use-in-prod-6a1c8d"
export UNSUBSCRIBE_SECRET="dev-only-unsubscribe-secret-6f2b0a"
export PUBLIC_AUTH_URL="http://localhost:4101"
export MASTER_SECRET_KEY="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
export PORTAL_PUBLIC_URL="http://localhost:3107"

start() {
  local name=$1 port=$2
  local dir="$ROOT/services/$name"
  echo "starting $name on :$port"
  (cd "$dir" && PORT=$port pnpm dev) > "/tmp/lumaara-$name.log" 2>&1 &
}

start auth-service 4101
start accounting-service 4102
start stock-service 4103
start crm-service 4104
start hr-service 4105
start projects-service 4106
start scheduler 4109
# MCP server — exposes 100+ tools to LLMs. Reads per-service URLs from env.
# See services/mcp-server/README for stdio (Claude Desktop) + HTTP+SSE usage.
export LUMAARA_AUTH_URL="http://localhost:4101"
export LUMAARA_ACCOUNTING_URL="http://localhost:4102"
export LUMAARA_STOCK_URL="http://localhost:4103"
export LUMAARA_CRM_URL="http://localhost:4104"
export LUMAARA_HR_URL="http://localhost:4105"
export LUMAARA_PROJECTS_URL="http://localhost:4106"
start mcp-server 4110
echo "all services launched. logs in /tmp/lumaara-*.log"
