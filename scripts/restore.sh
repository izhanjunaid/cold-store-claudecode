#!/usr/bin/env bash
# ColdChain — restore a database backup.
# DESTRUCTIVE: overwrites the current contents of the target database. Use with care.
#
# Usage:
#   scripts/restore.sh backups/coldchain-YYYYMMDD-HHMMSS.sql.gz
#   scripts/restore.sh backups/coldchain-YYYYMMDD-HHMMSS.sql.gz.enc   # needs BACKUP_PASSPHRASE
#
# Restore-drill tip: point this at a SCRATCH database first to prove your backups are
# actually recoverable (that's what validates your RTO).
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE=".env.production"
set -a; [[ -f "$ENV_FILE" ]] && . "$ENV_FILE"; set +a

file="${1:-}"
[[ -z "$file" || ! -f "$file" ]] && { echo "Usage: $0 <backup-file>"; exit 1; }

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

if [[ "$file" == *.enc ]]; then
  [[ -z "${BACKUP_PASSPHRASE:-}" ]] && { echo "ERROR: BACKUP_PASSPHRASE required to decrypt $file" >&2; exit 1; }
  openssl enc -d -aes-256-cbc -pbkdf2 -pass "pass:${BACKUP_PASSPHRASE}" -in "$file" | gunzip > "$tmp"
else
  gunzip -c "$file" > "$tmp"
fi

echo "==> Restoring '$file' into database '$POSTGRES_DB' (overwrites current data)..."
docker compose --env-file "$ENV_FILE" exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres \
  psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" < "$tmp"

echo "==> Restore complete."
