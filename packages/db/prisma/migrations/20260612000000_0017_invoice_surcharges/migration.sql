-- ============================================================
-- Migration 0017: Late payment surcharges (Phase 12)
--
--   * SURCHARGE journal entry type (JE-21: DR AR / CR 4210).
--   * invoice_surcharges: one row per applied surcharge. months_charged
--     records how many 30-day blocks the row covers so re-application
--     in the same period is rejected (idempotent by construction).
--   * invoices.surcharge_total_pkr: denormalised running total so
--     balance_due = total + surcharge_total - amount_paid everywhere.
-- ============================================================

-- 1. New journal entry type (must be first; cannot be used in the same tx)
ALTER TYPE "EntryType" ADD VALUE IF NOT EXISTS 'SURCHARGE';

-- 2. Surcharge records
CREATE TABLE IF NOT EXISTS "invoice_surcharges" (
  "id"                   UUID PRIMARY KEY,
  "facility_id"          UUID NOT NULL REFERENCES "facilities"("id"),
  "invoice_id"           UUID NOT NULL REFERENCES "invoices"("id"),
  "surcharge_date"       DATE NOT NULL,
  "months_charged"       INTEGER NOT NULL,
  "base_outstanding_pkr" DECIMAL(12,2) NOT NULL,
  "rate_pct_per_month"   DECIMAL(5,2) NOT NULL,
  "amount_pkr"           DECIMAL(12,2) NOT NULL,
  "journal_entry_id"     UUID UNIQUE REFERENCES "journal_entries"("id"),
  "notes"                TEXT,
  "created_at"           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "created_by"           UUID NOT NULL REFERENCES "users"("id")
);

CREATE INDEX IF NOT EXISTS "invoice_surcharges_facility_id_invoice_id_idx"
  ON "invoice_surcharges"("facility_id", "invoice_id");

-- 3. Audit trigger (same per-table pattern as the foundation tables)
CREATE OR REPLACE TRIGGER audit_invoice_surcharges
  AFTER INSERT OR UPDATE ON invoice_surcharges
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

-- 4. Denormalised surcharge total on invoices
ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "surcharge_total_pkr" DECIMAL(12,2) NOT NULL DEFAULT 0;
