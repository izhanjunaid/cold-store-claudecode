-- ============================================================================
-- ColdChain — least-privilege runtime role for the API (F-2a, part 2).
--
-- Run as the database OWNER ($POSTGRES_USER) with the app password supplied
-- as a psql variable:
--
--   psql -U coldchain -d coldchain -v app_password='<secret>' -f scripts/app-role.sql
--
-- Idempotent: safe to re-run on every install/update (it re-syncs the
-- password and re-applies grants). The installers and update.sh run it
-- automatically; you should never need to run it by hand.
--
-- What it sets up:
--   * coldchain_app — LOGIN role the `api` container connects as (see
--     docker-compose.yml). DML only: no DDL, no ownership.
--   * Grants on all current tables/sequences + DEFAULT PRIVILEGES so tables
--     created by future migrations (which run as the owner via the `migrate`
--     service) are granted automatically.
--   * NO EXECUTE on financial_guards_set(): migration 0010 revoked PUBLIC,
--     nothing here grants it back — so the runtime role cannot disable the
--     financial audit/immutability triggers. Only the owner (used solely by
--     the one-shot `migrate` service) can.
-- ============================================================================

-- Create the role if missing (NOLOGIN first; LOGIN + password set below where
-- psql variable interpolation works — :'var' is not expanded inside DO blocks).
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'coldchain_app') THEN
    CREATE ROLE coldchain_app NOLOGIN;
  END IF;
END
$$;

ALTER ROLE coldchain_app LOGIN PASSWORD :'app_password';

-- :DBNAME is set by psql to the connected database.
GRANT CONNECT ON DATABASE :"DBNAME" TO coldchain_app;
GRANT USAGE ON SCHEMA public TO coldchain_app;

-- DML on everything that exists now…
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO coldchain_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO coldchain_app;

-- …and on whatever future migrations create. Applies to objects created by
-- the role running this script (the owner) — which is exactly who runs
-- migrations — so this must execute as the owner, and new tables need no
-- follow-up grant. update.sh re-runs this script after migrate anyway as a
-- belt-and-braces for grants made under an older version of this file.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO coldchain_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO coldchain_app;
