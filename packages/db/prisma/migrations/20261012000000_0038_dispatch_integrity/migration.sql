-- 0038 — Dispatch integrity (fast-dispatch Phase 0).
--
-- Expand-only: new nullable columns, a backfill of one of them, a NOT VALID check,
-- audit triggers and the guard toggle's table list. The previous image ignores
-- every new column, and no enum changes (CANCELLED already exists on both
-- OutboundStatus and GatePassStatus).

-- ---------------------------------------------------------------------------
-- 1. outbound_events: who dispatched it, how it was cancelled, which truck took it.
--
-- finalized_by/at: the gate refuses to let the person who booked or dispatched a
-- withdrawal also release its truck, so both people must be on the row.
-- voided_*: a cancelled withdrawal follows the void convention (docs/25 §2).
-- gate_pass_id: the truck visit that carried this withdrawal out. Many withdrawals
-- can ride one truck; one withdrawal leaves on exactly one truck. SET NULL so test
-- cleanup and /v1/_test/reset may delete passes before withdrawals.
-- vehicle_number widened to the gate pass's 30: plates are now normalised the same
-- way on both sides, and a widening is metadata-only.
-- ---------------------------------------------------------------------------
ALTER TABLE "outbound_events"
  ADD COLUMN IF NOT EXISTS "finalized_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "finalized_by" UUID REFERENCES "users"("id"),
  ADD COLUMN IF NOT EXISTS "voided_at"    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "voided_by"    UUID REFERENCES "users"("id"),
  ADD COLUMN IF NOT EXISTS "void_reason"  TEXT,
  ADD COLUMN IF NOT EXISTS "gate_pass_id" UUID;

ALTER TABLE "outbound_events" DROP CONSTRAINT IF EXISTS "outbound_events_gate_pass_id_fkey";
ALTER TABLE "outbound_events" ADD CONSTRAINT "outbound_events_gate_pass_id_fkey"
  FOREIGN KEY ("gate_pass_id") REFERENCES "gate_passes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "outbound_events_gate_pass_id_idx" ON "outbound_events"("gate_pass_id");

ALTER TABLE "outbound_events" ALTER COLUMN "vehicle_number" TYPE VARCHAR(30);

-- ---------------------------------------------------------------------------
-- 2. gate_passes: who released the truck, and on whose authority.
--
-- The credit authorization used to be a request flag that left no trace; now the
-- manager, the moment and the amount released on credit are stored. override_reason
-- holds a manager's reason for releasing despite a count or plate mismatch.
-- ---------------------------------------------------------------------------
ALTER TABLE "gate_passes"
  ADD COLUMN IF NOT EXISTS "cleared_by"                   UUID REFERENCES "users"("id"),
  ADD COLUMN IF NOT EXISTS "credit_authorized_by"         UUID REFERENCES "users"("id"),
  ADD COLUMN IF NOT EXISTS "credit_authorized_at"         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "credit_authorized_amount_pkr" NUMERIC(14, 2),
  ADD COLUMN IF NOT EXISTS "override_reason"              TEXT;

-- ---------------------------------------------------------------------------
-- 3. Backfill: a withdrawal already released through a pass's legacy
-- related_outbound_id link is attached to that pass, so it cannot clear a second
-- truck. Where several CLEARED passes name one withdrawal (possible until now), the
-- first clearance wins. Runs before the audit triggers below exist, so it writes no
-- audit rows.
-- ---------------------------------------------------------------------------
UPDATE "outbound_events" o
   SET "gate_pass_id" = g."id"
  FROM (
    SELECT DISTINCT ON ("related_outbound_id") "id", "related_outbound_id"
      FROM "gate_passes"
     WHERE "status" = 'CLEARED' AND "related_outbound_id" IS NOT NULL
     ORDER BY "related_outbound_id", "cleared_at" NULLS LAST, "created_at"
  ) g
 WHERE o."id" = g."related_outbound_id"
   AND o."gate_pass_id" IS NULL;

-- ---------------------------------------------------------------------------
-- 4. A lot can never hold fewer than zero bags (docs/08 specified this; it was
-- never built, and finalize could drive a balance negative). NOT VALID +
-- conditional VALIDATE, the 0031 pattern: a box that already holds a negative lot
-- deploys with a warning instead of failing, and new writes are checked either way.
-- ---------------------------------------------------------------------------
ALTER TABLE "lots" DROP CONSTRAINT IF EXISTS "lots_current_balance_nonnegative";
ALTER TABLE "lots"
  ADD CONSTRAINT "lots_current_balance_nonnegative"
  CHECK ("current_balance_bags" >= 0) NOT VALID;

DO $$
BEGIN
  ALTER TABLE "lots" VALIDATE CONSTRAINT "lots_current_balance_nonnegative";
EXCEPTION WHEN check_violation THEN
  RAISE WARNING 'lots_current_balance_nonnegative: lots with a negative balance exist; left NOT VALID (new writes are still checked). Find them with: SELECT lot_number, current_balance_bags FROM lots WHERE current_balance_bags < 0';
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Audit trail for the stock and gate tables. A withdrawal, a truck release and a
-- party's credit terms are as much a control as an invoice (docs/16 F-8: the audit
-- trail is the compensating control in a facility too small for segregation of
-- duties). All four tables carry a uuid id and facility_id.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE TRIGGER audit_lots
  AFTER INSERT OR UPDATE OR DELETE ON "lots"
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE OR REPLACE TRIGGER audit_outbound_events
  AFTER INSERT OR UPDATE OR DELETE ON "outbound_events"
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE OR REPLACE TRIGGER audit_gate_passes
  AFTER INSERT OR UPDATE OR DELETE ON "gate_passes"
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE OR REPLACE TRIGGER audit_parties
  AFTER INSERT OR UPDATE OR DELETE ON "parties"
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

-- The guard toggle names its tables; add the four audited above so test cleanup
-- can switch their triggers off like the financial tables'.
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
                        'lots', 'outbound_events', 'gate_passes', 'parties')
  LOOP
    EXECUTE format('ALTER TABLE %I %s TRIGGER %I', t.table_name, v_mode, t.tgname);
  END LOOP;
END;
$$;
REVOKE EXECUTE ON FUNCTION financial_guards_set(boolean) FROM PUBLIC;
