-- ============================================================================
-- 0018 — sole_facility_id(): let an unauthenticated caller learn which facility
-- this box is, when there is exactly one.
--
-- Why this exists. Logging in requires knowing the facility id, but a browser
-- cannot know it until it has logged in once. The obvious fix — have the login
-- route fall back to the only facility — does not work for the API, because
-- `facilities` carries row-level security:
--
--     CREATE POLICY facility_isolation ON facilities
--       FOR ALL USING (id = current_setting('app.facility_id', true)::uuid);
--
-- On an unauthenticated request that GUC is unset, so the predicate is NULL and
-- the policy matches zero rows. The api connects as the least-privilege
-- coldchain_app role (F-2a), which RLS applies to. Integration tests connect as
-- the database OWNER, who bypasses RLS — which is exactly why this passed every
-- test and still failed on a real box. The release smoke test caught it.
--
-- SECURITY DEFINER runs the body as the function's owner, so it sees past the
-- policy. The exposure is deliberately minimal:
--   * returns a uuid and nothing else — no name, address, or settings
--   * returns NULL unless there is EXACTLY one facility, so a multi-tenant
--     deployment discloses nothing and the caller must still name its facility
--   * STABLE, no arguments, so it cannot be steered
--
-- On a single-facility box "which facility is this" is not a secret; it is the
-- one fact a client must have before it can authenticate at all.
--
-- EXECUTE is left at PostgreSQL's default (PUBLIC) on purpose: the caller is by
-- definition unauthenticated. Contrast financial_guards_set, which migration
-- 0010 revoked from PUBLIC precisely because it must never be reachable.
-- ============================================================================

CREATE OR REPLACE FUNCTION sole_facility_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
  v_id    uuid;
BEGIN
  SELECT count(*) INTO v_count FROM facilities;
  IF v_count <> 1 THEN
    RETURN NULL;
  END IF;
  SELECT id INTO v_id FROM facilities;
  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION sole_facility_id() IS
  'Returns the id of the only facility on this box, or NULL when there is not exactly one. Used by the unauthenticated login/password-reset routes so a browser that has never logged in can identify the facility. SECURITY DEFINER: facilities is under RLS keyed on app.facility_id, which is unset before authentication.';
