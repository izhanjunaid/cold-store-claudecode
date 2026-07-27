-- ============================================================================
-- 0013 — Employee advances (Phase 21)
--
-- Three prior audits flagged employee advances as absent: no model, no column,
-- no endpoint, no screen. The one place the system half-supported it —
-- payroll_line_items.other_deductions_pkr, documented as "Advances repaid,
-- etc." — was broken by design in phase/20: crediting a liability for an
-- advance recovery would leave the employee's receivable standing while
-- inventing an obligation, so finalize() rejects it outright rather than post
-- a wrong number.
--
-- This migration adds the receivable that makes recovery correct: a new
-- account 1230 (seeded separately via chart-of-accounts.ts, not here — see
-- that file's header), an EmployeeAdvance ledger, and a distinct
-- advance_recovery_pkr column on payroll lines so recovery is never conflated
-- with the still-undefined "other deductions" case.
--
-- EmployeeAdvanceRecovery deliberately has no journal_entry_id of its own:
-- recovery does not post a separate entry. It rides inside the payroll
-- entry (JE-15/JE-15B) as one more credit line to 1230, alongside the
-- existing EOBI/tax credit lines. The entry it belongs to is the payroll
-- run's payroll_journal_entry_id.
--
-- Modelled on party_loans / party_loan_repayments (peshgi), which this
-- mirrors in shape: same status lifecycle (ACTIVE/RECOVERED/WRITTEN_OFF),
-- same @unique per-facility document number, same soft-void pattern on the
-- child table so a reversed payroll run leaves an audit trail rather than
-- deleting rows.
-- ============================================================================

-- CreateEnum
CREATE TYPE "EmployeeAdvanceStatus" AS ENUM ('ACTIVE', 'RECOVERED', 'WRITTEN_OFF');

-- AlterTable
ALTER TABLE "payroll_line_items" ADD COLUMN "advance_recovery_pkr" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "employee_advances" (
    "id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "advance_number" VARCHAR(20) NOT NULL,
    "employee_id" UUID NOT NULL,
    "issue_date" DATE NOT NULL,
    "principal_pkr" DECIMAL(12,2) NOT NULL,
    "monthly_installment_pkr" DECIMAL(12,2) NOT NULL,
    "balance_outstanding_pkr" DECIMAL(12,2) NOT NULL,
    "status" "EmployeeAdvanceStatus" NOT NULL DEFAULT 'ACTIVE',
    "book_type" "BookType" NOT NULL DEFAULT 'PACCI',
    "source_asset_account_code" VARCHAR(10) NOT NULL,
    "issue_journal_entry_id" UUID,
    "write_off_journal_entry_id" UUID,
    "write_off_reason" TEXT,
    "write_off_at" TIMESTAMPTZ,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,

    CONSTRAINT "employee_advances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_advance_recoveries" (
    "id" UUID NOT NULL,
    "advance_id" UUID NOT NULL,
    "payroll_run_id" UUID NOT NULL,
    "payroll_line_item_id" UUID NOT NULL,
    "recovery_date" DATE NOT NULL,
    "amount_pkr" DECIMAL(12,2) NOT NULL,
    "voided_at" TIMESTAMPTZ,
    "voided_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,

    CONSTRAINT "employee_advance_recoveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "employee_advances_issue_journal_entry_id_key" ON "employee_advances"("issue_journal_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "employee_advances_write_off_journal_entry_id_key" ON "employee_advances"("write_off_journal_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "employee_advances_facility_id_advance_number_key" ON "employee_advances"("facility_id", "advance_number");

-- CreateIndex
CREATE INDEX "employee_advances_facility_id_employee_id_idx" ON "employee_advances"("facility_id", "employee_id");

-- CreateIndex
CREATE INDEX "employee_advances_facility_id_status_idx" ON "employee_advances"("facility_id", "status");

-- CreateIndex
CREATE INDEX "employee_advance_recoveries_advance_id_idx" ON "employee_advance_recoveries"("advance_id");

-- CreateIndex
CREATE INDEX "employee_advance_recoveries_payroll_run_id_idx" ON "employee_advance_recoveries"("payroll_run_id");

-- AddForeignKey
ALTER TABLE "employee_advances" ADD CONSTRAINT "employee_advances_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_advances" ADD CONSTRAINT "employee_advances_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_advances" ADD CONSTRAINT "employee_advances_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_advances" ADD CONSTRAINT "employee_advances_issue_journal_entry_id_fkey" FOREIGN KEY ("issue_journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_advances" ADD CONSTRAINT "employee_advances_write_off_journal_entry_id_fkey" FOREIGN KEY ("write_off_journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_advance_recoveries" ADD CONSTRAINT "employee_advance_recoveries_advance_id_fkey" FOREIGN KEY ("advance_id") REFERENCES "employee_advances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_advance_recoveries" ADD CONSTRAINT "employee_advance_recoveries_payroll_run_id_fkey" FOREIGN KEY ("payroll_run_id") REFERENCES "payroll_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_advance_recoveries" ADD CONSTRAINT "employee_advance_recoveries_payroll_line_item_id_fkey" FOREIGN KEY ("payroll_line_item_id") REFERENCES "payroll_line_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_advance_recoveries" ADD CONSTRAINT "employee_advance_recoveries_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
