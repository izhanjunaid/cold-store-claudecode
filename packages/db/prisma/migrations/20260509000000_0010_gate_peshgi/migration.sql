-- ============================================================
-- Migration 0010: Gate Pass (M10) + Peshgi (M11) Spec Realignment
--
-- Notes:
--   * Enum value rename uses ALTER TYPE … RENAME VALUE to avoid
--     drop-and-recreate (which would lose existing rows).
--   * payment_method on party_loan_repayments was sharing
--     ExpensePaymentMethod (CASH/CHEQUE/BANK_TRANSFER); we move it
--     to a dedicated RepaymentMethod enum. Any historical CHEQUE
--     rows are mapped to BANK_TRANSFER.
--   * Gate passes are custodial only — no journal entries.
-- ============================================================

-- 1. Enum rename (loss-free)
ALTER TYPE "PartyLoanStatus" RENAME VALUE 'FULLY_RECOVERED' TO 'RECOVERED';

-- 2. EntryType extension for write-off
ALTER TYPE "EntryType" ADD VALUE IF NOT EXISTS 'PESHGI_WRITE_OFF';

-- 3. New repayment-method enum (decoupled from expense voucher payment method)
CREATE TYPE "RepaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'DEDUCTED_FROM_PRODUCE');

ALTER TABLE "party_loan_repayments"
  ALTER COLUMN "payment_method" DROP DEFAULT;

ALTER TABLE "party_loan_repayments"
  ALTER COLUMN "payment_method" TYPE "RepaymentMethod"
  USING (CASE
    WHEN "payment_method"::text = 'CHEQUE' THEN 'BANK_TRANSFER'
    ELSE "payment_method"::text
  END)::"RepaymentMethod";

ALTER TABLE "party_loan_repayments"
  ALTER COLUMN "asset_account_code" DROP NOT NULL;

ALTER TABLE "party_loan_repayments"
  ADD COLUMN IF NOT EXISTS "payment_id" UUID NULL
  REFERENCES "payments"("id");

CREATE INDEX IF NOT EXISTS "party_loan_repayments_payment_id_idx"
  ON "party_loan_repayments"("payment_id");

-- 4. PartyLoan write-off columns
ALTER TABLE "party_loans"
  ADD COLUMN IF NOT EXISTS "write_off_journal_entry_id" UUID NULL UNIQUE
    REFERENCES "journal_entries"("id"),
  ADD COLUMN IF NOT EXISTS "write_off_reason" TEXT NULL,
  ADD COLUMN IF NOT EXISTS "write_off_at" TIMESTAMPTZ NULL;

-- 5. Loan number realign — 8B used PSH-YYYYMM-NNNN; spec is L-YYMMDD-NNN.
WITH renumbered AS (
  SELECT id,
         'L-' ||
           to_char("issue_date", 'YYMMDD') ||
           '-' ||
           lpad(
             row_number() OVER (
               PARTITION BY "facility_id", to_char("issue_date", 'YYMMDD')
               ORDER BY "created_at", "id"
             )::text,
             3,
             '0'
           ) AS new_number
  FROM "party_loans"
  WHERE "loan_number" LIKE 'PSH-%'
)
UPDATE "party_loans" pl
SET "loan_number" = r.new_number
FROM renumbered r
WHERE pl.id = r.id;

-- 6. PaymentAllocation gains optional loan_id; invoice_id becomes nullable; CHECK enforces XOR.
ALTER TABLE "payment_allocations"
  ALTER COLUMN "invoice_id" DROP NOT NULL;

ALTER TABLE "payment_allocations"
  ADD COLUMN IF NOT EXISTS "loan_id" UUID NULL
  REFERENCES "party_loans"("id");

CREATE INDEX IF NOT EXISTS "payment_allocations_loan_id_idx"
  ON "payment_allocations"("loan_id");

ALTER TABLE "payment_allocations"
  ADD CONSTRAINT "payment_allocations_target_xor"
  CHECK (("invoice_id" IS NOT NULL) <> ("loan_id" IS NOT NULL));

-- 7. Gate pass enums + table
CREATE TYPE "GatePassDirection" AS ENUM ('INWARD', 'OUTWARD');
CREATE TYPE "GatePassStatus" AS ENUM ('ARRIVED', 'WEIGHING', 'CLEARED', 'CANCELLED');

CREATE TABLE "gate_passes" (
  "id"                  UUID NOT NULL,
  "facility_id"         UUID NOT NULL,
  "pass_number"         VARCHAR(30) NOT NULL,
  "direction"           "GatePassDirection" NOT NULL,
  "vehicle_number"      VARCHAR(30) NOT NULL,
  "driver_name"         VARCHAR(100),
  "driver_phone"        VARCHAR(20),
  "bilty_number"        VARCHAR(50),
  "status"              "GatePassStatus" NOT NULL DEFAULT 'ARRIVED',
  "related_lot_id"      UUID,
  "related_outbound_id" UUID,
  "notes"               TEXT,
  "created_at"          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cleared_at"          TIMESTAMPTZ,
  "created_by"          UUID NOT NULL,
  CONSTRAINT "gate_passes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "gate_passes_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "facilities"("id"),
  CONSTRAINT "gate_passes_related_lot_id_fkey" FOREIGN KEY ("related_lot_id") REFERENCES "lots"("id"),
  CONSTRAINT "gate_passes_related_outbound_id_fkey" FOREIGN KEY ("related_outbound_id") REFERENCES "outbound_events"("id"),
  CONSTRAINT "gate_passes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id")
);

CREATE UNIQUE INDEX "gate_passes_facility_id_pass_number_key"
  ON "gate_passes"("facility_id", "pass_number");
CREATE INDEX "gate_passes_facility_id_status_idx"
  ON "gate_passes"("facility_id", "status");
CREATE INDEX "gate_passes_facility_id_vehicle_number_idx"
  ON "gate_passes"("facility_id", "vehicle_number");
CREATE INDEX "gate_passes_related_lot_id_idx" ON "gate_passes"("related_lot_id");
CREATE INDEX "gate_passes_related_outbound_id_idx" ON "gate_passes"("related_outbound_id");
