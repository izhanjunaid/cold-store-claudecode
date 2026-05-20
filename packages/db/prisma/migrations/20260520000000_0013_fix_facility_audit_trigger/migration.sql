-- ============================================================
-- Migration 0013: Fix facility audit trigger to handle empty session vars.
--
-- The `audit_trigger_self_facility_fn` function casted
-- `current_setting('app.user_id', true)::uuid` directly. When the GUC
-- was unset or '' (e.g. plain Prisma updates outside a SET LOCAL'd
-- request) the cast raised `invalid input syntax for type uuid: ""`
-- before COALESCE could substitute a fallback. The same pattern was
-- already fixed for the per-tenant `audit_trigger_fn` in Phase 0.
--
-- This replaces the function with the safe-null version, matching the
-- `audit_trigger_fn` body. Phase 11.5 PATCH /v1/facilities/me is the
-- first endpoint to actually exercise UPDATE on `facilities`, which is
-- why the bug surfaced now.
-- ============================================================

CREATE OR REPLACE FUNCTION audit_trigger_self_facility_fn() RETURNS TRIGGER AS $$
DECLARE
  v_user_id uuid;
  v_raw_user text;
BEGIN
  v_raw_user := current_setting('app.user_id', true);
  IF v_raw_user IS NOT NULL AND v_raw_user <> '' THEN
    v_user_id := v_raw_user::uuid;
  ELSE
    v_user_id := '00000000-0000-0000-0000-000000000000'::uuid;
  END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_log (id, facility_id, table_name, record_id, action, changed_by, changed_at, old_values, new_values)
    VALUES (
      gen_random_uuid(),
      NEW.id,
      TG_TABLE_NAME,
      NEW.id,
      'INSERT',
      v_user_id,
      NOW(),
      NULL,
      to_jsonb(NEW)
    );
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO audit_log (id, facility_id, table_name, record_id, action, changed_by, changed_at, old_values, new_values)
    VALUES (
      gen_random_uuid(),
      NEW.id,
      TG_TABLE_NAME,
      NEW.id,
      'UPDATE',
      v_user_id,
      NOW(),
      to_jsonb(OLD),
      to_jsonb(NEW)
    );
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
