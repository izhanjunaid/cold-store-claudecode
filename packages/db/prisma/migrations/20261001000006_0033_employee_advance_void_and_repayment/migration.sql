-- 0033 — Employee advances: a void, and repayment in cash (docs/25 C-26).
--
-- An advance could only be recovered through payroll, and an issued advance could
-- not be voided at all: a mistaken issue stayed in 1230 forever. Additive only —
-- an older image never writes these columns, and every payroll recovery it writes
-- still satisfies the new CHECK.

ALTER TABLE "employee_advances"
  ADD COLUMN "voided_at"   TIMESTAMPTZ,
  ADD COLUMN "voided_by"   UUID REFERENCES "users"("id"),
  ADD COLUMN "void_reason" TEXT;

-- A recovery is either a payroll deduction (it rides inside the run's JE-15 and
-- names the run and line) or a cash repayment (it has its own journal entry and
-- names the cash account it was paid into). Never both, never neither. The
-- account is checked by the application: this table has no facility_id for a
-- composite foreign key to the chart.
ALTER TABLE "employee_advance_recoveries"
  ALTER COLUMN "payroll_run_id" DROP NOT NULL,
  ALTER COLUMN "payroll_line_item_id" DROP NOT NULL,
  ADD COLUMN "journal_entry_id"   UUID REFERENCES "journal_entries"("id"),
  ADD COLUMN "asset_account_code" VARCHAR(10);

CREATE UNIQUE INDEX "employee_advance_recoveries_journal_entry_id_key"
  ON "employee_advance_recoveries"("journal_entry_id");

ALTER TABLE "employee_advance_recoveries"
  ADD CONSTRAINT "employee_advance_recoveries_one_kind" CHECK (
    ("payroll_run_id" IS NOT NULL AND "payroll_line_item_id" IS NOT NULL
       AND "journal_entry_id" IS NULL AND "asset_account_code" IS NULL)
    OR
    ("payroll_run_id" IS NULL AND "payroll_line_item_id" IS NULL
       AND "journal_entry_id" IS NOT NULL AND "asset_account_code" IS NOT NULL)
  ) NOT VALID;

DO $$
BEGIN
  ALTER TABLE "employee_advance_recoveries" VALIDATE CONSTRAINT "employee_advance_recoveries_one_kind";
EXCEPTION WHEN check_violation THEN
  RAISE WARNING 'employee_advance_recoveries_one_kind: existing rows violate it; left NOT VALID (new rows are still checked).';
END;
$$;
