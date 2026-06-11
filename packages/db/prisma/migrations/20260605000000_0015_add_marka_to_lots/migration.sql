-- ============================================================
-- Migration 0015: Add marka (goods-identification mark) to lots
--
-- Purpose:
--   * marka is the traditional identifying mark painted/stamped/written
--     on the bardana (gunny sacks) or crates of produce — the indigenous
--     equivalent of a shipping/consignee mark. It tells operators and
--     security WHOSE stack this is when many owners share a chamber.
--   * Captured at inbound, printed on the parchi + gate pass + dispatch
--     note, searchable in the lots list, and inherited by child lots on
--     partial transfer.
--
--   marka is NOT unique (one arhti may mark many farmers' lots the same)
--   and is nullable, so existing rows and flows are unaffected.
-- ============================================================

ALTER TABLE "lots" ADD COLUMN IF NOT EXISTS "marka" VARCHAR(100);

-- Index serves the dedicated prefix/exact marka filter ("find stack by marka").
CREATE INDEX IF NOT EXISTS "lots_facility_id_marka_idx" ON "lots" ("facility_id", "marka");
