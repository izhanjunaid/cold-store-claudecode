-- 0030 — Constraints for the accounting consolidation (docs/25).
--
-- Every constraint here is added NOT VALID and then validated only if no existing
-- row breaks it. A client database already carrying a bad row (the pre-update
-- checks in scripts/preupdate-checks-consolidation.sql find them) must still take
-- the update — a failed migration here would fail again every night and the box
-- would silently never update. A NOT VALID constraint still checks every row
-- inserted or updated from now on; the warning names what is left to correct.

-- ---------------------------------------------------------------------------
-- 1. Journal entries: REVERSED is no longer a posting status (docs/25 L-11).
--
-- Since 0025 a reversed entry stays POSTED and records `reversed_by`; nothing has
-- written REVERSED since v0.5.0, and the image this release rolls back to is
-- v0.5.x, so the legacy branch 0025 kept for rollback safety is retired. The
-- enum value itself is dropped in Release 2 (expand-only: update.ps1:256).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION guard_journal_entries_fn()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.posting_status = 'AUTO_DRAFT' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'journal entry % cannot be deleted once posted (post a reversal entry instead)', OLD.entry_number;
  END IF;

  IF OLD.posting_status = 'AUTO_DRAFT' THEN
    RETURN NEW;
  END IF;

  -- The one change a posted entry accepts: recording, once, which entry reversed it.
  IF OLD.posting_status = 'POSTED'
     AND NEW.posting_status = 'POSTED'
     AND OLD.reversed_by IS NULL
     AND NEW.reversed_by IS NOT NULL
     AND (to_jsonb(OLD) - 'reversed_by') = (to_jsonb(NEW) - 'reversed_by') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'journal entry % is immutable once posted (corrections require a reversal entry)', OLD.entry_number;
END;
$$;

ALTER TABLE "journal_entries"
  ADD CONSTRAINT "journal_entries_no_reversed_status"
  CHECK ("posting_status" <> 'REVERSED') NOT VALID;

-- An employee advance cannot be recovered past zero (docs/25 C-14).
ALTER TABLE "employee_advances"
  ADD CONSTRAINT "employee_advances_balance_nonnegative"
  CHECK ("balance_outstanding_pkr" >= 0) NOT VALID;

-- ---------------------------------------------------------------------------
-- 2. Configuration columns that name an account must name one that exists.
--
-- These replace the CONFIG_REFERENCES list in coa.service.ts, which an app-level
-- check could only consult on delete — a rate plan pointing at an account that
-- was never there failed at the next invoice, long after. Tables with no
-- facility_id of their own (party_loan_repayments, credit_note_line_items) cannot
-- carry a composite key and keep the application check.
-- ---------------------------------------------------------------------------
ALTER TABLE "rate_plans" ADD CONSTRAINT "rate_plans_revenue_account_fkey"
  FOREIGN KEY ("facility_id", "revenue_account_code") REFERENCES "chart_of_accounts" ("facility_id", "account_code")
  ON UPDATE RESTRICT ON DELETE RESTRICT NOT VALID;
ALTER TABLE "service_charges" ADD CONSTRAINT "service_charges_revenue_account_fkey"
  FOREIGN KEY ("facility_id", "revenue_account_code") REFERENCES "chart_of_accounts" ("facility_id", "account_code")
  ON UPDATE RESTRICT ON DELETE RESTRICT NOT VALID;
ALTER TABLE "payments" ADD CONSTRAINT "payments_asset_account_fkey"
  FOREIGN KEY ("facility_id", "asset_account_code") REFERENCES "chart_of_accounts" ("facility_id", "account_code")
  ON UPDATE RESTRICT ON DELETE RESTRICT NOT VALID;
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_asset_account_fkey"
  FOREIGN KEY ("facility_id", "asset_account_code") REFERENCES "chart_of_accounts" ("facility_id", "account_code")
  ON UPDATE RESTRICT ON DELETE RESTRICT NOT VALID;
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_accum_depr_account_fkey"
  FOREIGN KEY ("facility_id", "accum_depr_account_code") REFERENCES "chart_of_accounts" ("facility_id", "account_code")
  ON UPDATE RESTRICT ON DELETE RESTRICT NOT VALID;
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_depr_expense_account_fkey"
  FOREIGN KEY ("facility_id", "depr_expense_account_code") REFERENCES "chart_of_accounts" ("facility_id", "account_code")
  ON UPDATE RESTRICT ON DELETE RESTRICT NOT VALID;
ALTER TABLE "expense_vouchers" ADD CONSTRAINT "expense_vouchers_expense_account_fkey"
  FOREIGN KEY ("facility_id", "expense_account_code") REFERENCES "chart_of_accounts" ("facility_id", "account_code")
  ON UPDATE RESTRICT ON DELETE RESTRICT NOT VALID;
ALTER TABLE "expense_vouchers" ADD CONSTRAINT "expense_vouchers_asset_account_fkey"
  FOREIGN KEY ("facility_id", "asset_account_code") REFERENCES "chart_of_accounts" ("facility_id", "account_code")
  ON UPDATE RESTRICT ON DELETE RESTRICT NOT VALID;
ALTER TABLE "party_loans" ADD CONSTRAINT "party_loans_source_asset_account_fkey"
  FOREIGN KEY ("facility_id", "source_asset_account_code") REFERENCES "chart_of_accounts" ("facility_id", "account_code")
  ON UPDATE RESTRICT ON DELETE RESTRICT NOT VALID;
ALTER TABLE "employee_advances" ADD CONSTRAINT "employee_advances_source_asset_account_fkey"
  FOREIGN KEY ("facility_id", "source_asset_account_code") REFERENCES "chart_of_accounts" ("facility_id", "account_code")
  ON UPDATE RESTRICT ON DELETE RESTRICT NOT VALID;

-- ---------------------------------------------------------------------------
-- 3. Validate each where the data allows; warn — never fail the deploy — where
--    it does not.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('journal_entries',   'journal_entries_no_reversed_status'),
      ('employee_advances', 'employee_advances_balance_nonnegative'),
      ('rate_plans',        'rate_plans_revenue_account_fkey'),
      ('service_charges',   'service_charges_revenue_account_fkey'),
      ('payments',          'payments_asset_account_fkey'),
      ('fixed_assets',      'fixed_assets_asset_account_fkey'),
      ('fixed_assets',      'fixed_assets_accum_depr_account_fkey'),
      ('fixed_assets',      'fixed_assets_depr_expense_account_fkey'),
      ('expense_vouchers',  'expense_vouchers_expense_account_fkey'),
      ('expense_vouchers',  'expense_vouchers_asset_account_fkey'),
      ('party_loans',       'party_loans_source_asset_account_fkey'),
      ('employee_advances', 'employee_advances_source_asset_account_fkey')
    ) AS v(tbl, con)
  LOOP
    BEGIN
      EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I', r.tbl, r.con);
    EXCEPTION WHEN foreign_key_violation OR check_violation THEN
      RAISE WARNING 'constraint % on %: existing rows violate it; left NOT VALID (new rows are still checked). See docs/25 §8.', r.con, r.tbl;
    END;
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. The fiscal-year start becomes a stored fact (docs/25 L-05).
--
-- Settings are merged with code defaults at read time, so a facility that never
-- saved the key was relying on the default in whichever image is running. Once
-- any entry is posted the start month is frozen by the application, and a frozen
-- value has to be a stored one.
-- ---------------------------------------------------------------------------
UPDATE "facilities"
   SET "settings" = "settings" || '{"fiscal_year_start_month": 7}'::jsonb
 WHERE NOT ("settings" ? 'fiscal_year_start_month');
