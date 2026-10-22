-- 0040 — Standing credit approvals (fast-dispatch Phase C1a).
--
-- Expand-only: one new table, one new defaulted column, an audit trigger and the
-- guard toggle's table list. The previous image ignores both.
--
-- A manager pre-approves a party for credit: up to a ceiling on what it may owe, until
-- an optional date, revocable. The gate then releases a credit-billed truck of an
-- approved party without a manager walking to the gate, and stamps the approval on the
-- pass (gate_passes.credit_approval_ids) next to the existing credit_authorized_* trail.
-- A revoked approval is kept (revoked_* columns), never deleted; at most one approval
-- per party is active at a time.

CREATE TABLE IF NOT EXISTS "party_credit_approvals" (
  "id"                  UUID          NOT NULL DEFAULT gen_random_uuid(),
  "facility_id"         UUID          NOT NULL REFERENCES "facilities"("id"),
  "party_id"            UUID          NOT NULL REFERENCES "parties"("id"),
  -- The most the party may owe (both books, as the credit-limit warning measures it)
  -- while this approval carries a truck out on credit.
  "max_outstanding_pkr" NUMERIC(14,2) NOT NULL CHECK ("max_outstanding_pkr" > 0),
  -- Last business day the approval holds; NULL = until revoked.
  "valid_until"         DATE,
  "approved_by"         UUID          NOT NULL REFERENCES "users"("id"),
  "approved_at"         TIMESTAMPTZ   NOT NULL DEFAULT now(),
  "note"                TEXT,
  "revoked_at"          TIMESTAMPTZ,
  "revoked_by"          UUID          REFERENCES "users"("id"),
  "revoke_reason"       TEXT,
  CONSTRAINT "party_credit_approvals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "party_credit_approvals_party_idx"
  ON "party_credit_approvals" ("facility_id", "party_id");

-- One live approval per party: replacing one revokes the old row first.
CREATE UNIQUE INDEX IF NOT EXISTS "party_credit_approvals_one_active"
  ON "party_credit_approvals" ("party_id") WHERE "revoked_at" IS NULL;

-- Which approval(s) carried the truck out. An array because one truck can leave on
-- the credit of several billing parties.
ALTER TABLE "gate_passes"
  ADD COLUMN IF NOT EXISTS "credit_approval_ids" UUID[] NOT NULL DEFAULT '{}';

CREATE OR REPLACE TRIGGER audit_party_credit_approvals
  AFTER INSERT OR UPDATE OR DELETE ON "party_credit_approvals"
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

-- The guard toggle names its tables (replaced whole each time): 0038's list plus the new one.
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
                        'party_credit_approvals')
  LOOP
    EXECUTE format('ALTER TABLE %I %s TRIGGER %I', t.table_name, v_mode, t.tgname);
  END LOOP;
END;
$$;
REVOKE EXECUTE ON FUNCTION financial_guards_set(boolean) FROM PUBLIC;
