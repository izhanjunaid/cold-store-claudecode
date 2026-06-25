#!/usr/bin/env bash
# ColdChain — one-time provisioning for a facility box.
#
#   - Generates .env.production with strong random secrets (won't overwrite an existing one).
#   - Builds images, starts the stack, and waits for the API to be healthy.
#   - Migrations are applied automatically by the compose `migrate` service.
#   - Seeds initial data (DEMO facility + users). See the note below.
#
# Safe to re-run: an existing .env.production is preserved.
#
# Requires: Docker (with the compose plugin) and openssl on PATH.
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE=".env.production"

if [[ -f "$ENV_FILE" ]]; then
  echo "==> $ENV_FILE already exists — keeping existing secrets."
else
  echo "==> Generating $ENV_FILE with fresh secrets..."
  cat > "$ENV_FILE" <<EOF
POSTGRES_USER=coldchain
POSTGRES_PASSWORD=$(openssl rand -hex 24)
POSTGRES_DB=coldchain
JWT_SECRET=$(openssl rand -hex 48)
JWT_REFRESH_SECRET=$(openssl rand -hex 48)
PUBLIC_ORIGIN=http://coldchain.local
LOG_LEVEL=info
IMAGE_REGISTRY=ghcr.io/izhanjunaid
COLDCHAIN_TAG=latest
HEALTHCHECK_URL=
BACKUP_PASSPHRASE=
BACKUP_RCLONE_REMOTE=
BACKUP_RETENTION_DAYS=30
EOF
  chmod 600 "$ENV_FILE" 2>/dev/null || true
  echo "    Wrote $ENV_FILE — keep it safe and OUT of git."
fi

echo "==> Building images and starting the stack (this is slow the first time)..."
docker compose --env-file "$ENV_FILE" up -d --build

echo "==> Waiting for the API to become healthy..."
for i in $(seq 1 40); do
  if docker compose --env-file "$ENV_FILE" exec -T api curl -fsS http://localhost:3001/health >/dev/null 2>&1; then
    echo "    API healthy."
    break
  fi
  [[ "$i" == "40" ]] && { echo "    ERROR: API did not become healthy in time." >&2; exit 1; }
  sleep 3
done

# ---------------------------------------------------------------------------
# NO demo/test data is loaded. A client deployment is a clean install: the schema is
# applied by the `migrate` service above, and the client's real facility + users are
# created separately via the clean provisioning flow (scripts/provision-client.sh).
# ---------------------------------------------------------------------------
box_ip="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
echo ""
echo "==> Stack is up. NO demo/test/sample data was loaded (clean install)."
echo ""
echo "    NEXT — provision the client's real facility + users:"
echo "      1) cp scripts/client-config.example.json client-config.json"
echo "      2) edit client-config.json  (company details + owner/accountant/manager/staff)"
echo "      3) ./scripts/provision-client.sh client-config.json"
echo ""
echo "    Then open the app from any device on the LAN:"
echo "      http://${box_ip:-<this-box-ip>}/"
