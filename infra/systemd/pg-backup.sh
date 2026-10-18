#!/usr/bin/env bash
# pg-backup.sh — nightly host-level Postgres backup.
#
# Invoked by lumaara-pg-backup.service (systemd timer). Runs as `postgres`.
# Writes pg_dump custom-format (-Fc) with compression to $LUMAARA_BACKUP_DIR,
# then prunes files older than $LUMAARA_BACKUP_KEEP_DAYS.
#
# Restore:
#   sudo -u postgres createdb lumaara_restore
#   sudo -u postgres pg_restore -d lumaara_restore \
#     /var/lumaara/backups/postgres/lumaara-2026-09-29-02-30.dump
#
# See docs/RUNBOOKS.md § "Postgres restore drill" for the full procedure.

set -euo pipefail

DIR="${LUMAARA_BACKUP_DIR:-/var/lumaara/backups/postgres}"
DB="${LUMAARA_BACKUP_DB:-lumaara}"
KEEP="${LUMAARA_BACKUP_KEEP_DAYS:-30}"

mkdir -p "$DIR"
stamp=$(date -u +%Y-%m-%dT%H-%M-%SZ)
out="$DIR/${DB}-${stamp}.dump"

# -Fc = custom format (compressed, restorable with pg_restore).
# --no-owner --no-acl = restore works on a fresh cluster with different roles.
# -Z 9 = max compression (cheap given nightly cadence).
pg_dump -Fc --no-owner --no-acl -Z 9 -f "$out" "$DB"

# Verify pg_dump produced a valid archive before pruning older files.
pg_restore --list "$out" >/dev/null

# Prune older-than-KEEP dumps. -mtime +N = strictly older than N days.
find "$DIR" -maxdepth 1 -type f -name "${DB}-*.dump" -mtime +"$KEEP" -delete

# One structured JSON line per run for journal parsing.
size_bytes=$(stat -c%s "$out" 2>/dev/null || stat -f%z "$out")
echo "{\"kind\":\"pg-backup.ok\",\"db\":\"${DB}\",\"path\":\"${out}\",\"bytes\":${size_bytes},\"time\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}"
