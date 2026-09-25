-- 0028 — Account properties an owner-created account can also have (docs/25 §2).
--
-- "Is this cash?", "may a person post to it by hand?", "must every line name a
-- party?" used to be answered by lists of codes scattered across the API and the
-- web (seven different definitions of cash alone), so an owner's second bank
-- account was offered by one picker and refused by the server behind it. They
-- are properties of the account, so they live on the account.
--
-- Additive only (update.ps1 rolls back the image, never the database): an older
-- image ignores these columns, and every one has a default.

ALTER TABLE "chart_of_accounts"
  ADD COLUMN "is_cash_equivalent"   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "allow_manual_posting" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "requires_party"       BOOLEAN NOT NULL DEFAULT false;

-- Cash equivalents: every DETAIL under the Cash & Bank header, which catches the
-- bank accounts owners have added themselves (a list of codes never could),
-- except 1025 Cheques in Hand — a received cheque can still bounce, which is the
-- whole reason that account exists.
UPDATE "chart_of_accounts"
   SET "is_cash_equivalent" = true
 WHERE "parent_account_code" = '1000'
   AND "account_type" = 'DETAIL'
   AND "account_code" <> '1025';

-- The manual-posting matrix. A document-owned balance is only ever moved by its
-- document: a hand-posted line would split the ledger from the sub-ledger, and a
-- hand-posted line on an account an automated flow owns double-counts against it.
-- Every one of those flows now has its own reversal, which is the correction path.
UPDATE "chart_of_accounts"
   SET "allow_manual_posting" = false
 WHERE "account_code" IN (
   '1025', -- cheques in hand: receipt, clearing and dishonour only
   '1140', -- peshgi: loan issue, repayment and write-off only
   '1230', -- employee advances: issue, payroll recovery and write-off only
   '1250', -- accrued storage revenue: the month-end accrual only
   '2010', -- customer advances: receipts and their application only
   '2030', -- salaries payable: payroll only
   '3020', -- retained earnings: opening balances only
   '3030', -- current-year result: computed, never posted
   '5030', '5035', '6010', '6015',          -- payroll cost
   '5040', '6120', '6130', '6140',          -- depreciation / amortisation
   '4230', '6110',                          -- gain / loss on disposal
   '6080',                                  -- bad debts: the write-off flows
   '6160'                                   -- impairment loss
 );

-- Every line on a party-level control account must say whose it is, or aging,
-- statements and credit limits can never tie back to the ledger.
UPDATE "chart_of_accounts"
   SET "requires_party" = true
 WHERE "account_code" IN ('1110', '1120', '1130', '1140', '1150', '2010');

-- Once an account has postings, flipping whether it is cash or whether it needs a
-- party would silently restate history — the cash-flow statement and every party
-- balance read these. Same rule, and same trigger, as code/class/type/parent.
CREATE OR REPLACE FUNCTION guard_chart_of_accounts_fn()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.account_code IS DISTINCT FROM OLD.account_code
      OR NEW.account_class IS DISTINCT FROM OLD.account_class
      OR NEW.account_type IS DISTINCT FROM OLD.account_type
      OR NEW.parent_account_code IS DISTINCT FROM OLD.parent_account_code
      OR NEW.normal_balance IS DISTINCT FROM OLD.normal_balance
      OR NEW.is_cash_equivalent IS DISTINCT FROM OLD.is_cash_equivalent
      OR NEW.requires_party IS DISTINCT FROM OLD.requires_party)
     AND EXISTS (
       SELECT 1 FROM journal_entry_lines l
       WHERE l.facility_id = OLD.facility_id AND l.account_code = OLD.account_code
     ) THEN
    RAISE EXCEPTION 'account % structure is locked: it has journal postings (create a new account and reclassify instead)', OLD.account_code;
  END IF;
  RETURN NEW;
END;
$$;
