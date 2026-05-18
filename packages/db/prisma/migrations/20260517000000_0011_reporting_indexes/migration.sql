-- ============================================================
-- Migration 0011: Reporting indexes (M9)
--
-- Composite indexes that cover the dominant predicates used by
-- the /v1/reports/* endpoints. None of these duplicate existing
-- indexes — they are wider/more specific combinations needed by
-- aging, dashboard, and seasonal-summary aggregations.
-- ============================================================

CREATE INDEX IF NOT EXISTS "invoices_facility_status_invoice_date_idx"
  ON "invoices" ("facility_id", "status", "invoice_date");

CREATE INDEX IF NOT EXISTS "invoices_facility_billing_party_status_idx"
  ON "invoices" ("facility_id", "billing_party_id", "status");

CREATE INDEX IF NOT EXISTS "outbound_events_facility_outbound_date_status_idx"
  ON "outbound_events" ("facility_id", "outbound_date", "status");

CREATE INDEX IF NOT EXISTS "lots_facility_status_inbound_date_idx"
  ON "lots" ("facility_id", "status", "inbound_date");

CREATE INDEX IF NOT EXISTS "payments_facility_payment_date_status_idx"
  ON "payments" ("facility_id", "payment_date", "status");
