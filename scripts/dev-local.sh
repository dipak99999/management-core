#!/usr/bin/env bash
# Local dev launcher: ensures the user-owned Postgres cluster is running,
# then boots every service + web app via turbo.
#
# Overridable env:
#   PG_BIN    Postgres bin dir   (default: C:/Program Files/PostgreSQL/18/bin)
#   PG_DATA   cluster data dir   (default: $HOME/lumaara-pgdata)
#   PG_PORT   cluster port       (default: 5433)

set -euo pipefail

cd "$(dirname "$0")/.."

PG_BIN="${PG_BIN:-C:/Program Files/PostgreSQL/18/bin}"
PG_DATA="${PG_DATA:-$HOME/lumaara-pgdata}"
PG_PORT="${PG_PORT:-5433}"

if "$PG_BIN/pg_isready" -h 127.0.0.1 -p "$PG_PORT" -q; then
  echo "✓ Postgres already running on 127.0.0.1:$PG_PORT"
else
  echo "→ starting Postgres ($PG_DATA) on port $PG_PORT"
  # Detach fully — pg_ctl otherwise holds the terminal on Windows.
  "$PG_BIN/pg_ctl" -D "$PG_DATA" -o "-p $PG_PORT" -l "$PG_DATA/server.log" start \
    > /dev/null 2>&1 < /dev/null &
  for i in $(seq 1 30); do
    "$PG_BIN/pg_isready" -h 127.0.0.1 -p "$PG_PORT" -q && break
    [ "$i" -eq 30 ] && { echo "✗ Postgres did not start; see $PG_DATA/server.log" >&2; exit 1; }
    sleep 1
  done
  echo "✓ Postgres ready"
fi

# 16 persistent tasks (8 services + 8 web apps) — above turbo's default of 10.
exec pnpm exec turbo run dev --concurrency=20
