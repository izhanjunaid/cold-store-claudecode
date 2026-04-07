-- Migration: 0001_foundation
-- Tables: facilities, users, refresh_tokens, audit_log
-- Note: Tables created via Prisma db push; this file documents the additional
-- triggers, RLS policies, and functions applied after schema creation.

-- Audit trigger function
-- Safely handles empty/unset session variables (empty string cannot cast to uuid)
CREATE OR REPLACE FUNCTION audit_trigger_fn()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_user_id uuid;
  v_facility_id uuid;
  v_raw text;
BEGIN
  -- Safely resolve user_id from session variable
  v_raw := current_setting('app.user_id', true);
  IF v_raw IS NOT NULL AND v_raw <> '' THEN
    v_user_id := v_raw::uuid;
  ELSE
    v_user_id := '00000000-0000-0000-0000-000000000000'::uuid;
  END IF;

  -- Safely resolve facility_id (prefer row value, fall back to session)
  IF NEW.facility_id IS NOT NULL THEN
    v_facility_id := NEW.facility_id;
  ELSE
    v_raw := current_setting('app.facility_id', true);
    IF v_raw IS NOT NULL AND v_raw <> '' THEN
      v_facility_id := v_raw::uuid;
    ELSE
      v_facility_id := '00000000-0000-0000-0000-000000000000'::uuid;
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_log (id, facility_id, table_name, record_id, action, changed_by, changed_at, old_values, new_values)
    VALUES (gen_random_uuid(), v_facility_id, TG_TABLE_NAME, NEW.id, 'INSERT', v_user_id, NOW(), NULL, to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO audit_log (id, facility_id, table_name, record_id, action, changed_by, changed_at, old_values, new_values)
    VALUES (gen_random_uuid(), v_facility_id, TG_TABLE_NAME, NEW.id, 'UPDATE', v_user_id, NOW(), to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$;

-- Audit triggers
CREATE OR REPLACE TRIGGER audit_users
  AFTER INSERT OR UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

CREATE OR REPLACE TRIGGER audit_facilities
  AFTER INSERT OR UPDATE ON facilities
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

-- RLS
ALTER TABLE facilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY facility_isolation ON facilities
  FOR ALL USING (id = current_setting('app.facility_id', true)::uuid);

CREATE POLICY user_facility_isolation ON users
  FOR ALL USING (facility_id = current_setting('app.facility_id', true)::uuid);

CREATE POLICY refresh_token_facility_isolation ON refresh_tokens
  FOR ALL USING (facility_id = current_setting('app.facility_id', true)::uuid);

CREATE POLICY audit_log_facility_isolation ON audit_log
  FOR ALL USING (facility_id = current_setting('app.facility_id', true)::uuid);
