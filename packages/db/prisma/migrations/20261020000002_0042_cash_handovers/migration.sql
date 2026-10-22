-- 0042 — Cash handovers (fast-dispatch Phase C1c).
--
-- Expand-only: two new tables, an audit trigger on each and the guard toggle's list.
--
-- A collector (the munshi, a manager, the accountant) takes CASH receipts. A manager
-- counts that cash and records the handover: expected (the receipts not yet handed
-- over), counted, and the difference with a reason. Every receipt belongs to at most one
-- handover (UNIQUE payment_id), so the same cash cannot be counted twice and a voided
-- handover frees its receipts. A clean handover posts nothing: every cash receipt already
-- sits in 1010. A difference posts JE-28 (entry type CASH_VARIANCE, 0041) to Cash Short & Over.

CREATE TABLE IF NOT EXISTS "cash_handovers" (
  "id"                UUID          NOT NULL DEFAULT gen_random_uuid(),
  "facility_id"       UUID          NOT NULL REFERENCES "facilities"("id"),
  "handover_number"   VARCHAR(20)   NOT NULL,
  "business_date"     DATE          NOT NULL,
  "collector_id"      UUID          NOT NULL REFERENCES "users"("id"),
  "confirmed_by"      UUID          NOT NULL REFERENCES "users"("id"),
  "expected_cash_pkr" NUMERIC(14,2) NOT NULL CHECK ("expected_cash_pkr" >= 0),
  "counted_cash_pkr"  NUMERIC(14,2) NOT NULL CHECK ("counted_cash_pkr" >= 0),
  "variance_pkr"      NUMERIC(14,2) NOT NULL,
  "variance_reason"   TEXT,
  "journal_entry_id"  UUID          UNIQUE REFERENCES "journal_entries"("id"),
  "voided_at"         TIMESTAMPTZ,
  "voided_by"         UUID          REFERENCES "users"("id"),
  "void_reason"       TEXT,
  "created_at"        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT "cash_handovers_pkey" PRIMARY KEY ("id"),
  -- Nobody counts their own cash (the owner's own cash is not tracked at all).
  CONSTRAINT "cash_handovers_not_self" CHECK ("confirmed_by" <> "collector_id"),
  CONSTRAINT "cash_handovers_variance_is_difference" CHECK ("variance_pkr" = "counted_cash_pkr" - "expected_cash_pkr"),
  -- A difference always carries its reason.
  CONSTRAINT "cash_handovers_variance_reason" CHECK (
    "variance_pkr" = 0 OR ("variance_reason" IS NOT NULL AND length(btrim("variance_reason")) >= 3)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "cash_handovers_number_key"
  ON "cash_handovers" ("facility_id", "handover_number");
CREATE INDEX IF NOT EXISTS "cash_handovers_facility_date_idx"
  ON "cash_handovers" ("facility_id", "business_date");
CREATE INDEX IF NOT EXISTS "cash_handovers_collector_idx"
  ON "cash_handovers" ("collector_id");

CREATE TABLE IF NOT EXISTS "cash_handover_payments" (
  "id"          UUID NOT NULL DEFAULT gen_random_uuid(),
  "handover_id" UUID NOT NULL REFERENCES "cash_handovers"("id") ON DELETE CASCADE,
  "payment_id"  UUID NOT NULL UNIQUE REFERENCES "payments"("id"),
  CONSTRAINT "cash_handover_payments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "cash_handover_payments_handover_idx"
  ON "cash_handover_payments" ("handover_id");

CREATE OR REPLACE TRIGGER audit_cash_handovers
  AFTER INSERT OR UPDATE OR DELETE ON "cash_handovers"
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
-- No facility_id of its own: resolved through the parent, as payment_allocations does.
CREATE OR REPLACE TRIGGER audit_cash_handover_payments
  AFTER INSERT OR UPDATE OR DELETE ON "cash_handover_payments"
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn('cash_handovers', 'handover_id');

-- The guard toggle names its tables (replaced whole each time): 0040's list plus the two new ones.
CREATE OR REPLACE FUNCTION financial_guards_set(p_enabled boolean)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  t record;
  v_mode text := CASE WHEN p_enabled THEN 'ENABLE' ELSE 'DISABLE' END;
BEGIN
  FOR t IN
    SELECT c.relname AS table_name, g.tgname
    FROM pg_trigger g
    JOIN pg_class c ON c.oid = g.tgrelid
    WHERE NOT g.tgisinternal
      AND (g.tgname LIKE 'guard\_%' OR g.tgname LIKE 'audit\_%')
      AND c.relname IN ('chart_of_accounts', 'journal_entries', 'journal_entry_lines',
                        'period_locks', 'invoices', 'payments', 'payment_allocations',
                        'credit_notes', 'party_loans',
                        'party_loan_repayments', 'audit_log',
                        'bills', 'bill_lines', 'supplier_payments', 'supplier_payment_allocations',
                        'tax_remittances', 'cash_transfers', 'owner_equity_movements',
                        'partners', 'partner_profit_shares',
                        'lots', 'outbound_events', 'gate_passes', 'parties',
                        'party_credit_approvals',
                        'cash_handovers', 'cash_handover_payments')
  LOOP
    EXECUTE format('ALTER TABLE %I %s TRIGGER %I', t.table_name, v_mode, t.tgname);
  END LOOP;
END;
$$;
REVOKE EXECUTE ON FUNCTION financial_guards_set(boolean) FROM PUBLIC;
