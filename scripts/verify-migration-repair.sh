#!/usr/bin/env bash
# ColdChain — regression test for the migration-history repair in
# packages/db/prisma/deploy.ts.
#
# That repair is what unwedged the field box, and no vitest suite can reach it: it only
# runs against a `_prisma_migrations` state that cannot exist on a healthy database.
# So this builds the broken state deliberately.
#
# It REPRODUCES THE FAILURE FIRST and fails if the failure does not happen. A repair
# test that never sees a broken database proves nothing — it would pass just as happily
# against a no-op, which is exactly how the old advisory-lock tests stayed green for
# years while acquiring no lock (see apps/api/src/common/advisory-lock.ts).
#
# Usage:
#   scripts/verify-migration-repair.sh
#
# Needs a reachable PostgreSQL superuser via the standard PG* environment variables
# (PGHOST/PGPORT/PGUSER/PGPASSWORD). CI sets them from its postgres service; locally,
# point them at any throwaway server — e.g. a container started with:
#   docker run -d --rm -p 15433:5432 -e POSTGRES_PASSWORD=x postgres:16-alpine
#   PGHOST=localhost PGPORT=15433 PGUSER=postgres PGPASSWORD=x scripts/verify-migration-repair.sh
set -euo pipefail
cd "$(dirname "$0")/.."

DB="coldchain_repair_check_$$"
BASELINE="20260101000000_baseline"
MIGRATIONS="packages/db/prisma/migrations"

export PGHOST="${PGHOST:-localhost}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

pass() { echo "  ok   — $*"; }
fail() { echo "  FAIL — $*" >&2; exit 1; }

cleanup() { psql -q -d postgres -c "DROP DATABASE IF EXISTS \"$DB\";" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "==> Building a pre-rebaseline database ($DB)"
psql -q -d postgres -c "CREATE DATABASE \"$DB\";"
export DATABASE_URL="postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${DB}?schema=public"

# The schema as a box installed before the phase-13 rebaseline already has it…
psql -q -d "$DB" -v ON_ERROR_STOP=1 -f "$MIGRATIONS/$BASELINE/migration.sql" >/dev/null

# …and its history: the OLD migration names, with no baseline row. This is the exact
# shape of the field box (phases/phase-13-production-deploy.md, "Rebaseline impact").
psql -q -d "$DB" -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
CREATE TABLE _prisma_migrations (
  id VARCHAR(36) PRIMARY KEY,
  checksum VARCHAR(64) NOT NULL,
  finished_at TIMESTAMPTZ,
  migration_name VARCHAR(255) NOT NULL,
  logs TEXT,
  rolled_back_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_steps_count INTEGER NOT NULL DEFAULT 0
);
INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, applied_steps_count) VALUES
 ('a1','legacy', now(), '20260406000000_0001_foundation', 1),
 ('a2','legacy', now(), '20260408092717_0002_parties_chambers', 1),
 ('a3','legacy', now(), '20260410120000_0003_lots_billing_config', 1);
SQL

echo "==> The failure must reproduce before the fix means anything"
if (cd packages/db && pnpm exec prisma migrate deploy) >/dev/null 2>&1; then
  fail "plain \`migrate deploy\` SUCCEEDED against a pre-rebaseline database — this test is no longer reproducing the fault it exists to guard, so its green result is meaningless. Fix the fixture."
fi
pass "plain \`migrate deploy\` fails, as the client's box does"

# One failure is enough to poison it permanently: the baseline is now recorded failed,
# so every later attempt aborts with P3009 before touching anything.
if (cd packages/db && pnpm exec prisma migrate deploy) >/dev/null 2>&1; then
  fail "second \`migrate deploy\` succeeded — expected P3009 (failed migration found)"
fi
pass "it stays broken on retry (P3009) — permanently, without repair"

echo "==> db:deploy must repair it"
pnpm --filter @coldchain/db run db:deploy >/dev/null || fail "db:deploy exited non-zero against the wedged database"
pass "db:deploy completed"

unfinished=$(psql -tAq -d "$DB" -c "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL;")
[ "$unfinished" = "0" ] || fail "$unfinished migration(s) still unfinished after repair"
pass "no unfinished migrations remain"

# The baseline must be ADOPTED, never re-run — re-running its CREATE TABLEs against an
# existing schema is the original fault.
applied=$(psql -tAq -d "$DB" -c "SELECT count(*) FROM _prisma_migrations WHERE migration_name = '$BASELINE' AND finished_at IS NOT NULL;")
[ "$applied" = "1" ] || fail "baseline is not recorded as applied (count=$applied)"
pass "baseline adopted rather than replayed"

# Every real migration in the tree must have actually run.
expected=$(find "$MIGRATIONS" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')
actual=$(psql -tAq -d "$DB" -c "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND migration_name NOT LIKE '2026040%' AND migration_name NOT LIKE '20260408%' AND migration_name NOT LIKE '20260410%';")
[ "$actual" = "$expected" ] || fail "expected $expected migrations applied, found $actual"
pass "all $expected migrations applied"

# The legacy rows are someone else's history; leave them alone.
legacy=$(psql -tAq -d "$DB" -c "SELECT count(*) FROM _prisma_migrations WHERE checksum = 'legacy';")
[ "$legacy" = "3" ] || fail "legacy history rows were modified (found $legacy of 3)"
pass "pre-rebaseline history rows left untouched"

echo "==> Second run must be a clean no-op"
out="$(pnpm --filter @coldchain/db run db:deploy 2>&1)" || fail "second db:deploy exited non-zero"
echo "$out" | grep -q "No pending migrations to apply" || fail "second run tried to apply migrations again"
pass "idempotent"

echo ""
echo "Migration repair verified."
