-- 0035 — The deferred contraction ("Release 2"), shipped in v0.6.1 (docs/25 §10).
--
-- Releases are expand-only because the previous image keeps running against the
-- migrated database until the swap, and after a failed update. This file is the one
-- exception, and it is safe for one reason: no facility ever ran v0.6.0. The client
-- box is wiped and installed fresh on v0.6.1, so no older image will ever read this
-- database. Every release after this one is expand-only again.
--
-- What goes is only what existed for databases from before v0.6: the retired
-- expense vouchers, two dead columns, the REVERSED posting status, and the trigger
-- that let an older image insert a party without its control account.

-- ---------------------------------------------------------------------------
-- 1. Expense vouchers (docs/25 C-03): replaced by supplier bills. Nothing creates
--    one; a fresh database never holds one.
-- ---------------------------------------------------------------------------
ALTER TABLE "bills" DROP COLUMN "legacy_expense_voucher_id";
DROP TABLE "expense_vouchers";
DROP TYPE "ExpenseVoucherStatus";
DROP TYPE "ExpensePaymentMethod";

-- The guard toggle names its tables; take the dropped one out of the list.
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
                        'partners', 'partner_profit_shares')
  LOOP
    EXECUTE format('ALTER TABLE %I %s TRIGGER %I', t.table_name, v_mode, t.tgname);
  END LOOP;
END;
$$;
REVOKE EXECUTE ON FUNCTION financial_guards_set(boolean) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 2. Dead columns. cash_flow_section has not been read since the cash-flow section
--    became derived from the header (docs/25 L-19); other_deductions_pkr had no
--    ledger home and nothing writes it (C-17).
-- ---------------------------------------------------------------------------
ALTER TABLE "chart_of_accounts" DROP COLUMN "cash_flow_section";
DROP TYPE "CashFlowSection";
ALTER TABLE "payroll_line_items" DROP COLUMN "other_deductions_pkr";

-- ---------------------------------------------------------------------------
-- 3. Every party carries its control account (docs/25 R-01). The app always sets
--    it; the trigger existed only for an older image inserting during a rollback.
-- ---------------------------------------------------------------------------
DROP TRIGGER "parties_default_control_account" ON "parties";
DROP FUNCTION "parties_default_control_account_fn"();
ALTER TABLE "parties" ALTER COLUMN "control_account_code" SET NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. PostingStatus without REVERSED. A reversed entry stays POSTED and records
--    reversed_by (0025); 0030's CHECK already refused the value.
--
--    The partial index and the CHECK below compare posting_status to a literal of
--    the type itself, so they cannot survive the type changing under them: drop
--    them, swap the type, recreate them unchanged.
-- ---------------------------------------------------------------------------
DROP INDEX "journal_entries_one_opening_balance_per_facility";
ALTER TABLE "journal_entries" DROP CONSTRAINT "journal_entries_no_reversed_status";
ALTER TABLE "journal_entries" DROP CONSTRAINT "journal_entries_posted_has_number";
ALTER TABLE "journal_entries" ALTER COLUMN "posting_status" DROP DEFAULT;

ALTER TYPE "PostingStatus" RENAME TO "PostingStatus_old";
CREATE TYPE "PostingStatus" AS ENUM ('AUTO_DRAFT', 'POSTED');
ALTER TABLE "journal_entries"
  ALTER COLUMN "posting_status" TYPE "PostingStatus" USING "posting_status"::text::"PostingStatus";
DROP TYPE "PostingStatus_old";

ALTER TABLE "journal_entries" ALTER COLUMN "posting_status" SET DEFAULT 'POSTED';
ALTER TABLE "journal_entries"
  ADD CONSTRAINT "journal_entries_posted_has_number"
  CHECK ("posting_status" <> 'POSTED' OR "entry_number" IS NOT NULL);
CREATE UNIQUE INDEX journal_entries_one_opening_balance_per_facility
  ON journal_entries (facility_id)
  WHERE source_table = 'opening_balances'
    AND posting_status = 'POSTED'
    AND reversed_by IS NULL
    AND entry_type <> 'REVERSAL';

-- ---------------------------------------------------------------------------
-- 5. No account can fall outside the statements (docs/25 L-31/L-34/L-38). Create
--    and update already refuse both shapes; this makes them impossible, and the
--    statements' "unclassified" bucket goes with them.
-- ---------------------------------------------------------------------------
ALTER TABLE "chart_of_accounts"
  ADD CONSTRAINT "chart_of_accounts_header_has_section"
  CHECK ("account_type" <> 'HEADER' OR "account_class" = 'EQUITY' OR "statement_section" IS NOT NULL);
ALTER TABLE "chart_of_accounts"
  ADD CONSTRAINT "chart_of_accounts_detail_has_parent"
  CHECK ("account_type" <> 'DETAIL' OR "account_class" = 'EQUITY' OR "parent_account_code" IS NOT NULL);
