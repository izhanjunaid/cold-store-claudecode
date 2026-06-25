#!/usr/bin/env bash
# Provision a CLEAN production database for a NEW client — no demo/test/sample data.
#
# Creates only: the client's facility, their real users (each with a unique strong
# temporary password and forced change on first login), and the standard Chart of
# Accounts. Refuses to run unless the database is empty (override: PROVISION_FORCE=1).
#
# Usage:
#   cp scripts/client-config.example.json client-config.json
#   # edit client-config.json with the client's company + user details
#   ./scripts/provision-client.sh client-config.json
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE=".env.production"
CONFIG="${1:-client-config.json}"
[ -f "$ENV_FILE" ] || { echo "ERROR: $ENV_FILE not found — run scripts/bootstrap.sh first."; exit 1; }
[ -f "$CONFIG" ]   || { echo "ERROR: config '$CONFIG' not found."; echo "Copy scripts/client-config.example.json and fill it in."; exit 1; }

echo "==> Provisioning a clean database from: $CONFIG"
docker compose --env-file "$ENV_FILE" run --rm \
  -v "$(realpath "$CONFIG"):/app/packages/db/client-config.json:ro" \
  -e CLIENT_CONFIG=/app/packages/db/client-config.json \
  ${PROVISION_FORCE:+-e PROVISION_FORCE="$PROVISION_FORCE"} \
  migrate pnpm --filter @coldchain/db run db:provision
