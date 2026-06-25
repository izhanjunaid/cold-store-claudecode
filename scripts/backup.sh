#!/usr/bin/env bash
# ColdChain — database backup.
#
#   - Dumps Postgres via the compose container (no host pg_dump needed).
#   - Optionally encrypts at rest (openssl AES-256) when BACKUP_PASSPHRASE is set.
#   - Rotates local dumps older than BACKUP_RETENTION_DAYS.
#   - Optionally syncs offsite with rclone when BACKUP_RCLONE_REMOTE is set
#     (skips quietly when offline — it just retries next run).
#
# Schedule nightly, e.g.:
#   Linux cron:           0 1 * * *  /opt/coldchain/scripts/backup.sh >> /var/log/coldchain-backup.log 2>&1
#   Windows Task Scheduler: run  bash scripts/backup.sh  daily (Git Bash or WSL).
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE=".env.production"
set -a; [[ -f "$ENV_FILE" ]] && . "$ENV_FILE"; set +a

BACKUP_DIR="backups"
mkdir -p "$BACKUP_DIR"
ts="$(date +%Y%m%d-%H%M%S)"
out="$BACKUP_DIR/coldchain-$ts.sql.gz"

echo "==> Dumping database to $out ..."
docker compose --env-file "$ENV_FILE" exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists \
  | gzip -9 > "$out"

if [[ -n "${BACKUP_PASSPHRASE:-}" ]]; then
  echo "==> Encrypting backup..."
  openssl enc -aes-256-cbc -pbkdf2 -salt -pass "pass:${BACKUP_PASSPHRASE}" -in "$out" -out "$out.enc"
  rm -f "$out"
  out="$out.enc"
fi
echo "==> Local backup written: $out"

# Rotate local copies.
find "$BACKUP_DIR" -type f -name 'coldchain-*' -mtime +"${BACKUP_RETENTION_DAYS:-30}" -delete 2>/dev/null || true

# Offsite sync (best-effort; needs internet).
if [[ -n "${BACKUP_RCLONE_REMOTE:-}" ]]; then
  if command -v rclone >/dev/null 2>&1; then
    echo "==> Syncing offsite to $BACKUP_RCLONE_REMOTE ..."
    rclone copy "$out" "$BACKUP_RCLONE_REMOTE" --no-traverse \
      || echo "    (offsite sync failed — likely offline; will retry next run)"
  else
    echo "    rclone not installed; skipping offsite sync."
  fi
fi

echo "==> Backup complete."
