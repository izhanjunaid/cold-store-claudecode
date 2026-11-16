-- 0049 — Dated settings (docs/32 section 2.2, Stage 1).
--
-- Expand-only: one new table and its audit trigger. facilities.settings stays what is in force
-- now, written as before, so the previous image reads every setting unchanged.
--
-- Each row is one saved change of one business setting: its value and the day it takes effect.
-- A change dated today is applied to facilities.settings at once (applied_at set). A change dated
-- ahead waits here (applied_at NULL) and is applied on its day. Rows are never edited in value and
-- never deleted, so "what was this setting on that day" always has an answer. The first change of
-- a setting also stores a baseline row (effective 1900-01-01) holding the value it replaced.

CREATE TABLE IF NOT EXISTS "facility_setting_versions" (
  "id"             UUID         NOT NULL DEFAULT gen_random_uuid(),
  "facility_id"    UUID         NOT NULL REFERENCES "facilities"("id"),
  "key"            VARCHAR(60)  NOT NULL,
  "value"          JSONB        NOT NULL,
  "effective_from" DATE         NOT NULL,
  "note"           TEXT,
  "created_by"     UUID         REFERENCES "users"("id"),
  "created_at"     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  "applied_at"     TIMESTAMPTZ,
  CONSTRAINT "facility_setting_versions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "facility_setting_versions_key_idx"
  ON "facility_setting_versions" ("facility_id", "key", "effective_from");

CREATE OR REPLACE TRIGGER audit_facility_setting_versions
  AFTER INSERT OR UPDATE OR DELETE ON "facility_setting_versions"
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
