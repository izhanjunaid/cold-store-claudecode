-- 0043 — Gate count attempts (C3 part 1, docs/28 D4).
--
-- Expand-only: one new table; nothing existing is touched, so the previous image keeps running on
-- the migrated database (it simply never writes here).
--
-- A guard used to retype the bag count until it matched, and a refused release rolled back with
-- nothing to show for it. Now each wrong count is saved: the number typed, the number the dispatch
-- expected, who typed it and when. Tries are counted per plate since the plate's last release (the
-- newest cleared_at among its CLEARED passes), so logging the same truck in again starts nothing
-- over. The rows are the record: no audit trigger, no update path. Deleting a pass deletes its counts.

CREATE TABLE IF NOT EXISTS "gate_count_attempts" (
  "id"                UUID         NOT NULL DEFAULT gen_random_uuid(),
  "facility_id"       UUID         NOT NULL REFERENCES "facilities"("id"),
  "gate_pass_id"      UUID         NOT NULL REFERENCES "gate_passes"("id") ON DELETE CASCADE,
  -- The normalized plate (letters and digits), as normalizePlate() writes it.
  "plate"             VARCHAR(30)  NOT NULL,
  "declared_quantity" INTEGER      NOT NULL,
  "expected_quantity" INTEGER      NOT NULL,
  "created_by"        UUID         NOT NULL REFERENCES "users"("id"),
  "created_at"        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT "gate_count_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "gate_count_attempts_declared_nonneg" CHECK ("declared_quantity" >= 0),
  CONSTRAINT "gate_count_attempts_expected_nonneg" CHECK ("expected_quantity" >= 0)
);

CREATE INDEX IF NOT EXISTS "gate_count_attempts_plate_idx"
  ON "gate_count_attempts" ("facility_id", "plate", "created_at");
CREATE INDEX IF NOT EXISTS "gate_count_attempts_pass_idx"
  ON "gate_count_attempts" ("gate_pass_id");
