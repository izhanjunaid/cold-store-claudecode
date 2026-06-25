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

api_healthy() {
  for _ in $(seq 1 20); do
    if compose exec -T api curl -fsS http://localhost:3001/health >/dev/null 2>&1; then return 0; fi
    sleep 3
  done
  return 1
}

log "updating to '$NEW_TAG' (previous: '$PREV_TAG')"
set_tag "$NEW_TAG"

if ! compose pull; then
  log "ERROR: image pull failed (offline?). Reverting tag to '$PREV_TAG'."
  set_tag "$PREV_TAG"
  exit 1
fi

# Brings up the one-shot migrate (prisma migrate deploy), then recreates api/web/caddy.
compose up -d

if api_healthy; then
  log "SUCCESS: '$NEW_TAG' is healthy."
  heartbeat "${HEALTHCHECK_URL:-}"
  exit 0
fi

log "FAILED: '$NEW_TAG' did not become healthy. Rolling back to '$PREV_TAG'."
set_tag "$PREV_TAG"
compose pull >/dev/null 2>&1 || true
compose up -d
if api_healthy; then
  log "Rolled back to '$PREV_TAG' (healthy)."
else
  log "CRITICAL: rollback to '$PREV_TAG' is also unhealthy — manual intervention required."
fi
heartbeat "${HEALTHCHECK_URL:+$HEALTHCHECK_URL/fail}"
exit 1
