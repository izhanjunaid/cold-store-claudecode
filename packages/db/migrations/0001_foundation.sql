-- Migration: 0001_foundation
-- Tables: facilities, users, refresh_tokens, audit_log
-- Note: Tables created via Prisma db push; this file documents the additional
-- triggers, RLS policies, and functions applied after schema creation.

-- Audit trigger function
CREATE OR REPLACE FUNCTION audit_trigger_fn()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_log (id, facility_id, table_name, record_id, action, changed_by, changed_at, old_values, new_values)
    VALUES (
      gen_random_uuid(),
      COALESCE(NEW.facility_id, current_setting('app.facility_id', true)::uuid),
      TG_TABLE_NAME,
      NEW.id,
      'INSERT',
      COALESCE(current_setting('app.user_id', true)::uuid, '00000000-0000-0000-0000-000000000000'::uuid),
      NOW(),
      NULL,
      to_jsonb(NEW)
    );
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO audit_log (id, facility_id, table_name, record_id, action, changed_by, changed_at, old_values, new_values)
    VALUES (
      gen_random_uuid(),
      COALESCE(NEW.facility_id, current_setting('app.facility_id', true)::uuid),
      TG_TABLE_NAME,
      NEW.id,
      'UPDATE',
      COALESCE(current_setting('app.user_id', true)::uuid, '00000000-0000-0000-0000-000000000000'::uuid),
      NOW(),
      to_jsonb(OLD),
      to_jsonb(NEW)
    );
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
