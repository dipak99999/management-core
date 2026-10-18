#!/usr/bin/env bash
# wait-ready.sh — poll a service's /health/ready endpoint until it returns 200
# or the deadline expires. Used as `ExecStartPost=` in systemd units so
# `systemctl start` doesn't return until the backend is actually serving
# traffic — nginx never sees a half-booted upstream.
#
# Usage:
#   wait-ready.sh PORT [DEADLINE_SECONDS]
#
# Exits non-zero on deadline miss; systemd interprets that as a failed
# ExecStartPost and (per Restart=on-failure) kicks the service back into
# the crashloop backoff.

set -euo pipefail

PORT="${1:?PORT required}"
DEADLINE="${2:-60}"
URL="http://127.0.0.1:${PORT}/health/ready"

end=$(( $(date +%s) + DEADLINE ))
while [ "$(date +%s)" -lt "$end" ]; do
  if curl -fsS --max-time 2 "$URL" >/dev/null 2>&1; then
    echo "wait-ready: ${URL} → 200 (ready)"
    exit 0
  fi
  sleep 1
done

echo "wait-ready: ${URL} did not return 200 within ${DEADLINE}s" >&2
exit 1
