-- ============================================================
-- Migration 0014: Gate Pass verification fields + outbound owner snapshot
--
-- Purpose:
--   * Gate-side quantity verification: security can record a declared
--     bag/crate count on the pass; a mismatch flag is raised when the
--     declared count diverges from the linked lot/outbound quantity.
--   * Inward depositor: record whose goods arrived at the gate before
--     the lot is created/linked.
--   * Outbound owner snapshot: capture the lot's CURRENT owner at the
--     moment of withdrawal so the gateman can verify identity and so a
--     non-owner release is auditable.
--
--   All columns are nullable (or carry a default), so existing rows and
--   flows are unaffected.
-- ============================================================

-- 1. Gate pass verification columns
ALTER TABLE "gate_passes"
  ADD COLUMN IF NOT EXISTS "declared_quantity"      INTEGER,
  ADD COLUMN IF NOT EXISTS "party_id"               UUID,
  ADD COLUMN IF NOT EXISTS "quantity_mismatch_flag" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "gate_passes"
  ADD CONSTRAINT "gate_passes_party_id_fkey"
  FOREIGN KEY ("party_id") REFERENCES "parties"("id");

CREATE INDEX IF NOT EXISTS "gate_passes_party_id_idx" ON "gate_passes"("party_id");

-- 2. Outbound current-owner snapshot
ALTER TABLE "outbound_events"
  ADD COLUMN IF NOT EXISTS "owner_party_id_snapshot" UUID;

ALTER TABLE "outbound_events"
  ADD CONSTRAINT "outbound_events_owner_party_id_snapshot_fkey"
  FOREIGN KEY ("owner_party_id_snapshot") REFERENCES "parties"("id");
