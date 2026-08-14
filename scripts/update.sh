#!/usr/bin/env bash
# ColdChain — box-side updater. Rolls the facility box forward to a published release,
# applies DB migrations, health-checks, and ROLLS BACK to the previous tag on failure.
#
# Pull-based: it fetches pre-built images from the registry (no building on the box).
# Run it when the box has internet — manually, or on a schedule:
#   Linux cron:           0 3 * * *  /opt/coldchain/scripts/update.sh latest >> /var/log/coldchain-update.log 2>&1
#   Windows Task Sched:   bash scripts/update.sh latest   (Git Bash / WSL)
#
# Usage:
#   ./scripts/update.sh v1.2.3     # update to a specific release tag (recommended)
#   ./scripts/update.sh            # re-pull the tag currently in .env.production
#
# NOTE: migrations are roll-FORWARD only. Use expand-contract (backward-compatible)
# migrations so the previous image still works against the new schema if we roll back.
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE=".env.production"
[ -f "$ENV_FILE" ] || { echo "No $ENV_FILE — run scripts/bootstrap.sh first."; exit 1; }

log() { echo "[update $(date -u +%FT%TZ)] $*"; }
compose() { docker compose --env-file "$ENV_FILE" "$@"; }

# Boxes provisioned before the F-2a hardening lack the app-role vars — add them
# before sourcing, so this update run creates the role and the recreated api
# container can log in as it.
if ! grep -qE '^APP_DB_PASSWORD=' "$ENV_FILE"; then
  echo "[update] adding least-privilege app-role credentials to $ENV_FILE"
  printf 'APP_DB_USER=coldchain_app\nAPP_DB_PASSWORD=%s\n' "$(openssl rand -hex 24)" >> "$ENV_FILE"
fi

# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a
PREV_TAG="${COLDCHAIN_TAG:-latest}"
NEW_TAG="${1:-$PREV_TAG}"

set_tag() {
  if grep -qE '^COLDCHAIN_TAG=' "$ENV_FILE"; then
    sed -i "s|^COLDCHAIN_TAG=.*|COLDCHAIN_TAG=$1|" "$ENV_FILE"
  else
    printf '\nCOLDCHAIN_TAG=%s\n' "$1" >> "$ENV_FILE"
  fi
}

heartbeat() { [ -n "${HEALTHCHECK_URL:-}" ] && curl -fsS -m 10 "$1" >/dev/null 2>&1 || true; }

# Put the version tag AND the deploy files back together. Reverting one without the
# other is worse than reverting neither: the new compose file's `db:deploy` command
# does not exist in the old api image, so the migrate one-shot would never complete
# and `service_completed_successfully` would keep the api from ever starting.
revert_all() {
  set_tag "$PREV_TAG"
  for f in "${DEPLOY_FILES[@]:-}"; do [ -f "$f.prev" ] && mv -f "$f.prev" "$f"; done
  compose pull >/dev/null 2>&1 || true
  compose up -d || log "WARNING: could not bring '$PREV_TAG' back up."
}

# Create/sync the least-privilege runtime role (F-2a). Idempotent; safe to run
# against a live stack. Run before recreating containers (so the api's new
# credentials work immediately) and again after migrations (so tables granted
# under an older app-role.sql are covered too).
sync_app_role() {
  compose exec -T postgres \
    psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -v app_password="$APP_DB_PASSWORD" -f - < scripts/app-role.sql \
    || log "WARNING: app-role sync failed (is Postgres up?)."
}

api_healthy() {
  for _ in $(seq 1 20); do
    if compose exec -T api curl -fsS http://localhost:3001/health >/dev/null 2>&1; then return 0; fi
    sleep 3
  done
  return 1
}

log "updating to '$NEW_TAG' (previous: '$PREV_TAG')"

# Safety net: dump the DB before anything changes. Migrations are transactional,
# but a pre-update backup makes "restore to before the update" a one-liner
# (scripts/restore.sh) instead of an incident.
if bash scripts/backup.sh; then
  log "pre-update backup written."
else
  log "WARNING: pre-update backup failed (stack down or disk full?). Continuing — migrations are transactional, but consider aborting (Ctrl+C within 10s) if this box has irreplaceable data."
  sleep 10
fi

set_tag "$NEW_TAG"

# Ensure the app role exists on the still-running old stack BEFORE containers
# are recreated with the (possibly new) app-role credentials.
sync_app_role

if ! compose pull; then
  log "ERROR: image pull failed (offline?). Reverting tag to '$PREV_TAG'."
  set_tag "$PREV_TAG"
  exit 1
fi

# The deploy files ride along inside the api image, so a release that changes compose,
# Caddy or the app-role grants reaches the box without anyone shipping a new folder.
# The files and the image are a matched pair — revert_all() puts both back together,
# because this release's compose file calls `db:deploy`, which an older api image has
# no script for.
DEPLOY_FILES=(docker-compose.yml Caddyfile scripts/app-role.sql)
for f in "${DEPLOY_FILES[@]}"; do [ -f "$f" ] && cp -f "$f" "$f.prev"; done
if docker create --name coldchain-bundle "${IMAGE_REGISTRY:-ghcr.io/izhanjunaid}/coldchain-api:$NEW_TAG" >/dev/null 2>&1; then
  for f in "${DEPLOY_FILES[@]}"; do docker cp "coldchain-bundle:/app/$f" "$f" >/dev/null 2>&1 || true; done
  docker rm -f coldchain-bundle >/dev/null 2>&1 || true
  log "deploy files refreshed from the '$NEW_TAG' image."
  compose pull || { log "ERROR: refreshed compose file references unpullable images."; revert_all; exit 1; }
else
  log "WARNING: could not read deploy files from the image — keeping the current ones."
fi

# Ensure the role exists before migrations, so ALTER DEFAULT PRIVILEGES covers the
# tables they create.
sync_app_role

# Database FIRST, explicitly — api/web are still on the OLD images, so a failure here
# costs nothing but a log line. `run --rm` rather than letting `up -d` decide whether
# the exited one-shot needs re-running.
#
# db:deploy is not plain `prisma migrate deploy`: it also repairs a migration history
# that a failed or pre-rebaseline migration would otherwise wedge permanently, and adds
# chart-of-accounts entries the release introduced. See packages/db/prisma/deploy.ts.
if ! compose run --rm migrate; then
  log "ERROR: database update failed. '$PREV_TAG' is still running and the data is untouched."
  revert_all
  exit 1
fi

# Re-sync grants now that this release's migrations have run.
sync_app_role

# Now swap api/web/caddy onto the new images.
if ! compose up -d; then
  log "ERROR: '$NEW_TAG' failed to start. Rolling back to '$PREV_TAG'."
  revert_all
  exit 1
fi

if api_healthy; then
  log "SUCCESS: '$NEW_TAG' is healthy."
  for f in "${DEPLOY_FILES[@]}"; do rm -f "$f.prev"; done
  heartbeat "${HEALTHCHECK_URL:-}"
  exit 0
fi

log "FAILED: '$NEW_TAG' did not become healthy. Rolling back to '$PREV_TAG'."
revert_all
if api_healthy; then
  log "Rolled back to '$PREV_TAG' (healthy)."
else
  log "CRITICAL: rollback to '$PREV_TAG' is also unhealthy — manual intervention required."
fi
heartbeat "${HEALTHCHECK_URL:+$HEALTHCHECK_URL/fail}"
exit 1
