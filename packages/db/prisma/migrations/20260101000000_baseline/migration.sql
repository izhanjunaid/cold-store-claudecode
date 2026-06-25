-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'MANAGER', 'ACCOUNTANT', 'OPERATOR', 'SECURITY', 'VIEWER');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('INSERT', 'UPDATE');

-- CreateEnum
CREATE TYPE "PartyType" AS ENUM ('FARMER', 'TRADER', 'ARHTI', 'BUYER', 'OTHER');

-- CreateEnum
CREATE TYPE "TemperatureSource" AS ENUM ('MANUAL', 'SENSOR');

-- CreateEnum
CREATE TYPE "RateType" AS ENUM ('SEASONAL_PER_BAG', 'MONTHLY_PER_BAG', 'DAILY_PER_BAG');

-- CreateEnum
CREATE TYPE "ServiceUnitType" AS ENUM ('PER_BAG', 'PER_TON', 'FLAT');

-- CreateEnum
CREATE TYPE "LotStatus" AS ENUM ('ACTIVE', 'CLOSED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "BookType" AS ENUM ('PACCI', 'KATCHI');

-- CreateEnum
CREATE TYPE "OwnershipEventType" AS ENUM ('INITIAL', 'TRANSFER_IN', 'TRANSFER_OUT');

-- CreateEnum
CREATE TYPE "WithdrawalType" AS ENUM ('FULL', 'PARTIAL');

-- CreateEnum
CREATE TYPE "OutboundStatus" AS ENUM ('PENDING', 'WEIGHED', 'DISPATCHED', 'CANCELLED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'FINALIZED', 'VOID', 'WRITTEN_OFF');

-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('PERCENT', 'FIXED');

-- CreateEnum
CREATE TYPE "InvoiceLineType" AS ENUM ('STORAGE', 'SERVICE', 'ADJUSTMENT', 'ADVANCE_APPLIED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CHEQUE', 'BANK_TRANSFER', 'MOBILE_WALLET');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('RECORDED', 'ALLOCATED', 'ADVANCE', 'DISHONOURED');

-- CreateEnum
CREATE TYPE "ClearanceStatus" AS ENUM ('NA', 'PENDING', 'CLEARED', 'BOUNCED');

-- CreateEnum
CREATE TYPE "AccountClass" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'COST_OF_SERVICE', 'EXPENSE');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('HEADER', 'DETAIL');

-- CreateEnum
CREATE TYPE "NormalBalance" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "EntryType" AS ENUM ('INVOICE', 'PAYMENT', 'ADVANCE', 'ADVANCE_APPLIED', 'CREDIT_NOTE', 'ADJUSTMENT', 'ACCRUAL', 'BAD_DEBT', 'REVERSAL', 'SPOILAGE', 'SPOILAGE_SETTLEMENT', 'DEPRECIATION', 'ASSET_PURCHASE', 'ASSET_DISPOSAL', 'PAYROLL', 'PAYROLL_PAYMENT', 'GOVT_REMITTANCE', 'EXPENSE', 'PESHGI_ISSUE', 'PESHGI_RECOVERY', 'PESHGI_WRITE_OFF');

-- CreateEnum
CREATE TYPE "PostingStatus" AS ENUM ('AUTO_DRAFT', 'POSTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "CreditNoteStatus" AS ENUM ('ISSUED', 'APPLIED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AssetCategory" AS ENUM ('COLD_PLANT', 'BUILDING', 'VEHICLE', 'COMPUTER', 'OTHER');

-- CreateEnum
CREATE TYPE "DepreciationMethod" AS ENUM ('SLM', 'WDV');

-- CreateEnum
CREATE TYPE "FixedAssetStatus" AS ENUM ('PLANNED', 'PURCHASED', 'IN_SERVICE', 'DISPOSED', 'WRITTEN_OFF');

-- CreateEnum
CREATE TYPE "DepreciationScheduleStatus" AS ENUM ('PENDING', 'POSTED');

-- CreateEnum
CREATE TYPE "EmployeeType" AS ENUM ('SALARIED', 'DAILY_WAGE');

-- CreateEnum
CREATE TYPE "PayrollType" AS ENUM ('MONTHLY_SALARY', 'DAILY_WAGES');

-- CreateEnum
CREATE TYPE "PayrollRunStatus" AS ENUM ('DRAFT', 'FINALIZED', 'PAID');

-- CreateEnum
CREATE TYPE "ExpenseVoucherStatus" AS ENUM ('DRAFT', 'APPROVED', 'ACCRUED', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ExpensePaymentMethod" AS ENUM ('CASH', 'CHEQUE', 'BANK_TRANSFER');

-- CreateEnum
CREATE TYPE "PartyLoanStatus" AS ENUM ('ACTIVE', 'RECOVERED', 'WRITTEN_OFF');

-- CreateEnum
CREATE TYPE "RepaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'DEDUCTED_FROM_PRODUCE');

-- CreateEnum
CREATE TYPE "GatePassDirection" AS ENUM ('INWARD', 'OUTWARD');

-- CreateEnum
CREATE TYPE "GatePassStatus" AS ENUM ('ARRIVED', 'WEIGHING', 'CLEARED', 'CANCELLED');

-- CreateTable
CREATE TABLE "facilities" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "address" TEXT,
    "city" VARCHAR(100) NOT NULL DEFAULT 'Lahore',
    "phone" VARCHAR(20),
    "gst_number" VARCHAR(50),
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "facilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "email" VARCHAR(200) NOT NULL,
    "password_hash" VARCHAR(200) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "name_urdu" VARCHAR(200),
    "role" "UserRole" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMPTZ,
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ,
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "token_hash" VARCHAR(200) NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "table_name" VARCHAR(100) NOT NULL,
    "record_id" UUID NOT NULL,
    "action" "AuditAction" NOT NULL,
    "changed_by" UUID NOT NULL,
    "changed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "old_values" JSONB,
    "new_values" JSONB NOT NULL,
    "reason" TEXT,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parties" (
    "id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "name_urdu" VARCHAR(200),
    "party_type" "PartyType" NOT NULL,
    "phone_primary" VARCHAR(20) NOT NULL,
    "phone_secondary" VARCHAR(20),
    "address" TEXT,
    "cnic" VARCHAR(15),
    "parent_arhti_id" UUID,
    "credit_limit_pkr" DECIMAL(12,2),
    "credit_terms_days" INTEGER NOT NULL DEFAULT 30,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,

    CONSTRAINT "parties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commodities" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "unit_label" VARCHAR(20) NOT NULL,
    "default_storage_days_alert" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "commodities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "varieties" (
    "id" UUID NOT NULL,
    "commodity_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "varieties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chambers" (
    "id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "commodity_restriction" UUID,
    "max_capacity_bags" INTEGER NOT NULL,
    "temperature_min_c" DECIMAL(4,1),
    "temperature_max_c" DECIMAL(4,1),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,

    CONSTRAINT "chambers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "temperature_logs" (
    "id" UUID NOT NULL,
    "chamber_id" UUID NOT NULL,
    "recorded_at" TIMESTAMPTZ NOT NULL,
    "temperature_c" DECIMAL(4,1) NOT NULL,
    "recorded_by" UUID NOT NULL,
    "source" "TemperatureSource" NOT NULL DEFAULT 'MANUAL',

    CONSTRAINT "temperature_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_plans" (
    "id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "commodity_id" UUID,
    "rate_type" "RateType" NOT NULL,
    "rate_amount_pkr" DECIMAL(10,2) NOT NULL,
    "season_start_date" DATE,
    "season_end_date" DATE,
    "min_billing_days" INTEGER NOT NULL DEFAULT 1,
    "revenue_account_code" VARCHAR(10),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rate_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_charges" (
    "id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "unit_type" "ServiceUnitType" NOT NULL,
    "unit_price_pkr" DECIMAL(10,2) NOT NULL,
    "revenue_account_code" VARCHAR(10),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_charges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lots" (
    "id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "lot_number" VARCHAR(30) NOT NULL,
    "chamber_id" UUID NOT NULL,
    "owner_party_id" UUID NOT NULL,
    "billing_party_id" UUID NOT NULL,
    "commodity_id" UUID NOT NULL,
    "variety_id" UUID,
    "rate_plan_id" UUID NOT NULL,
    "quantity_bags" INTEGER NOT NULL,
    "current_balance_bags" INTEGER NOT NULL,
    "accepted_weight_kg" DECIMAL(10,2) NOT NULL,
    "declared_weight_kg" DECIMAL(10,2),
    "weight_dispute_flag" BOOLEAN NOT NULL DEFAULT false,
    "weight_dispute_note" TEXT,
    "quality_grade_inbound" VARCHAR(2),
    "inbound_date" DATE NOT NULL,
    "entry_date" DATE NOT NULL,
    "parent_lot_id" UUID,
    "vehicle_number" VARCHAR(20),
    "marka" VARCHAR(100),
    "status" "LotStatus" NOT NULL DEFAULT 'ACTIVE',
    "closed_at" DATE,
    "book_type" "BookType" NOT NULL DEFAULT 'PACCI',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,

    CONSTRAINT "lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ownership_history" (
    "id" UUID NOT NULL,
    "lot_id" UUID NOT NULL,
    "event_type" "OwnershipEventType" NOT NULL,
    "from_party_id" UUID,
    "to_party_id" UUID NOT NULL,
    "quantity_bags" INTEGER NOT NULL,
    "transfer_price_pkr" DECIMAL(12,2),
    "effective_date" DATE NOT NULL,
    "operator_id" UUID NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ownership_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbound_events" (
    "id" UUID NOT NULL,
    "lot_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "withdrawal_type" "WithdrawalType" NOT NULL,
    "quantity_withdrawn_bags" INTEGER NOT NULL,
    "outbound_weight_kg" DECIMAL(10,2),
    "outbound_date" DATE NOT NULL,
    "receiving_party_id" UUID,
    "owner_party_id_snapshot" UUID,
    "vehicle_number" VARCHAR(20),
    "dispatch_note_number" VARCHAR(30),
    "status" "OutboundStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,

    CONSTRAINT "outbound_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "invoice_number" VARCHAR(30),
    "lot_id" UUID NOT NULL,
    "outbound_event_id" UUID,
    "billing_party_id" UUID NOT NULL,
    "invoice_date" DATE NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "sub_total_pkr" DECIMAL(12,2) NOT NULL,
    "discount_type" "DiscountType",
    "discount_value" DECIMAL(12,2),
    "discount_amount_pkr" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "gst_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "gst_amount_pkr" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_pkr" DECIMAL(12,2) NOT NULL,
    "amount_paid_pkr" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "finalized_at" TIMESTAMPTZ,
    "finalized_by" UUID,
    "book_type" "BookType" NOT NULL DEFAULT 'PACCI',
    "journal_entry_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_line_items" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "line_type" "InvoiceLineType" NOT NULL,
    "description" VARCHAR(300) NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL,
    "unit_price_pkr" DECIMAL(10,2) NOT NULL,
    "amount_pkr" DECIMAL(12,2) NOT NULL,
    "service_charge_id" UUID,
    "rate_plan_id" UUID,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "party_id" UUID NOT NULL,
    "payment_date" DATE NOT NULL,
    "amount_pkr" DECIMAL(12,2) NOT NULL,
    "payment_method" "PaymentMethod" NOT NULL,
    "reference_number" VARCHAR(100),
    "is_advance" BOOLEAN NOT NULL DEFAULT false,
    "status" "PaymentStatus" NOT NULL DEFAULT 'RECORDED',
    "clearance_status" "ClearanceStatus" NOT NULL DEFAULT 'NA',
    "cheque_date" DATE,
    "book_type" "BookType" NOT NULL DEFAULT 'PACCI',
    "asset_account_code" VARCHAR(10),
    "journal_entry_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocations" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "invoice_id" UUID,
    "loan_id" UUID,
    "allocated_amount_pkr" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chart_of_accounts" (
    "id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "account_code" VARCHAR(10) NOT NULL,
    "account_name" VARCHAR(200) NOT NULL,
    "account_class" "AccountClass" NOT NULL,
    "account_type" "AccountType" NOT NULL,
    "parent_account_code" VARCHAR(10),
    "normal_balance" "NormalBalance" NOT NULL,
    "is_system_account" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chart_of_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "entry_number" VARCHAR(20) NOT NULL,
    "entry_date" DATE NOT NULL,
    "entry_type" "EntryType" NOT NULL,
    "book_type" "BookType" NOT NULL DEFAULT 'PACCI',
    "source_table" VARCHAR(50) NOT NULL,
    "source_id" UUID NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "posting_status" "PostingStatus" NOT NULL DEFAULT 'POSTED',
    "period_month" INTEGER NOT NULL,
    "period_year" INTEGER NOT NULL,
    "reversed_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entry_lines" (
    "id" UUID NOT NULL,
    "journal_entry_id" UUID NOT NULL,
    "line_number" INTEGER NOT NULL,
    "account_code" VARCHAR(10) NOT NULL,
    "facility_id" UUID NOT NULL,
    "debit_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credit_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "party_id" UUID,
    "lot_id" UUID,
    "description" VARCHAR(300),

    CONSTRAINT "journal_entry_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_notes" (
    "id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "credit_note_number" VARCHAR(30),
    "original_invoice_id" UUID NOT NULL,
    "billing_party_id" UUID NOT NULL,
    "credit_date" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "total_pkr" DECIMAL(12,2) NOT NULL,
    "status" "CreditNoteStatus" NOT NULL DEFAULT 'ISSUED',
    "book_type" "BookType" NOT NULL DEFAULT 'PACCI',
    "journal_entry_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,

    CONSTRAINT "credit_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_note_line_items" (
    "id" UUID NOT NULL,
    "credit_note_id" UUID NOT NULL,
    "revenue_account_code" VARCHAR(10) NOT NULL,
    "description" VARCHAR(300) NOT NULL,
    "amount_pkr" DECIMAL(12,2) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "credit_note_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "period_locks" (
    "id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "period_year" INTEGER NOT NULL,
    "period_month" INTEGER NOT NULL,
    "locked_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_by" UUID NOT NULL,
    "unlocked_at" TIMESTAMPTZ,
    "unlocked_by" UUID,
    "reason" TEXT,

    CONSTRAINT "period_locks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_assets" (
    "id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "asset_number" VARCHAR(20) NOT NULL,
    "asset_name" VARCHAR(200) NOT NULL,
    "asset_category" "AssetCategory" NOT NULL,
    "asset_account_code" VARCHAR(10) NOT NULL,
    "accum_depr_account_code" VARCHAR(10) NOT NULL,
    "depr_expense_account_code" VARCHAR(10) NOT NULL,
    "purchase_date" DATE NOT NULL,
    "purchase_cost_pkr" DECIMAL(14,2) NOT NULL,
    "residual_value_pkr" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "useful_life_years" DECIMAL(5,2),
    "depreciation_method" "DepreciationMethod" NOT NULL,
    "wdv_rate_percent" DECIMAL(5,2),
    "depreciation_start_date" DATE,
    "status" "FixedAssetStatus" NOT NULL DEFAULT 'PURCHASED',
    "accumulated_depreciation_pkr" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "disposal_date" DATE,
    "disposal_proceeds_pkr" DECIMAL(14,2),
    "purchase_journal_entry_id" UUID,
    "disposal_journal_entry_id" UUID,
    "book_type" "BookType" NOT NULL DEFAULT 'PACCI',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,

    CONSTRAINT "fixed_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "depreciation_schedules" (
    "id" UUID NOT NULL,
    "fixed_asset_id" UUID NOT NULL,
    "period_year" INTEGER NOT NULL,
    "period_month" INTEGER NOT NULL,
    "opening_nbv_pkr" DECIMAL(14,2) NOT NULL,
    "depreciation_amount_pkr" DECIMAL(14,2) NOT NULL,
    "closing_nbv_pkr" DECIMAL(14,2) NOT NULL,
    "status" "DepreciationScheduleStatus" NOT NULL DEFAULT 'PENDING',
    "journal_entry_id" UUID,
    "posted_at" TIMESTAMPTZ,

    CONSTRAINT "depreciation_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "name_urdu" VARCHAR(200),
    "cnic" VARCHAR(15),
    "employee_type" "EmployeeType" NOT NULL,
    "designation" VARCHAR(100),
    "join_date" DATE NOT NULL,
    "basic_salary_pkr" DECIMAL(10,2),
    "daily_wage_pkr" DECIMAL(8,2),
    "eobi_registered" BOOLEAN NOT NULL DEFAULT false,
    "bank_account_number" VARCHAR(30),
    "bank_name" VARCHAR(100),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "termination_date" DATE,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_runs" (
    "id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "run_number" VARCHAR(20) NOT NULL,
    "payroll_type" "PayrollType" NOT NULL,
    "period_year" INTEGER NOT NULL,
    "period_month" INTEGER NOT NULL,
    "period_from" DATE NOT NULL,
    "period_to" DATE NOT NULL,
    "total_gross_pkr" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_deductions_pkr" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_employer_eobi_pkr" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_net_payable_pkr" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "PayrollRunStatus" NOT NULL DEFAULT 'DRAFT',
    "book_type" "BookType" NOT NULL DEFAULT 'PACCI',
    "payroll_journal_entry_id" UUID,
    "payment_journal_entry_id" UUID,
    "remittance_journal_entry_id" UUID,
    "finalized_by" UUID,
    "finalized_at" TIMESTAMPTZ,
    "paid_at" TIMESTAMPTZ,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_line_items" (
    "id" UUID NOT NULL,
    "payroll_run_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "days_worked" DECIMAL(5,2),
    "gross_pay_pkr" DECIMAL(10,2) NOT NULL,
    "eobi_employee_pkr" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "eobi_employer_pkr" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "income_tax_pkr" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "other_deductions_pkr" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "net_pay_pkr" DECIMAL(10,2) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "payroll_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_vouchers" (
    "id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "voucher_number" VARCHAR(20) NOT NULL,
    "voucher_date" DATE NOT NULL,
    "payment_date" DATE,
    "expense_account_code" VARCHAR(10) NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "vendor_name" VARCHAR(200),
    "reference_number" VARCHAR(100),
    "amount_pkr" DECIMAL(12,2) NOT NULL,
    "payment_method" "ExpensePaymentMethod",
    "asset_account_code" VARCHAR(10),
    "is_accrual" BOOLEAN NOT NULL DEFAULT false,
    "status" "ExpenseVoucherStatus" NOT NULL DEFAULT 'DRAFT',
    "book_type" "BookType" NOT NULL DEFAULT 'PACCI',
    "accrual_journal_entry_id" UUID,
    "payment_journal_entry_id" UUID,
    "receipt_url" VARCHAR(500),
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ,
    "notes" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_vouchers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "party_loans" (
    "id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "loan_number" VARCHAR(20) NOT NULL,
    "party_id" UUID NOT NULL,
    "issue_date" DATE NOT NULL,
    "principal_pkr" DECIMAL(12,2) NOT NULL,
    "balance_outstanding_pkr" DECIMAL(12,2) NOT NULL,
    "status" "PartyLoanStatus" NOT NULL DEFAULT 'ACTIVE',
    "book_type" "BookType" NOT NULL DEFAULT 'PACCI',
    "source_asset_account_code" VARCHAR(10) NOT NULL,
    "issue_journal_entry_id" UUID,
    "write_off_journal_entry_id" UUID,
    "write_off_reason" TEXT,
    "write_off_at" TIMESTAMPTZ,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,

    CONSTRAINT "party_loans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "party_loan_repayments" (
    "id" UUID NOT NULL,
    "loan_id" UUID NOT NULL,
    "repayment_date" DATE NOT NULL,
    "amount_pkr" DECIMAL(12,2) NOT NULL,
    "payment_method" "RepaymentMethod" NOT NULL,
    "asset_account_code" VARCHAR(10),
    "payment_id" UUID,
    "journal_entry_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,

    CONSTRAINT "party_loan_repayments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gate_passes" (
    "id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "pass_number" VARCHAR(30) NOT NULL,
    "direction" "GatePassDirection" NOT NULL,
    "vehicle_number" VARCHAR(30) NOT NULL,
    "driver_name" VARCHAR(100),
    "driver_phone" VARCHAR(20),
    "bilty_number" VARCHAR(50),
    "status" "GatePassStatus" NOT NULL DEFAULT 'ARRIVED',
    "related_lot_id" UUID,
    "related_outbound_id" UUID,
    "declared_quantity" INTEGER,
    "party_id" UUID,
    "quantity_mismatch_flag" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cleared_at" TIMESTAMPTZ,
    "created_by" UUID NOT NULL,

    CONSTRAINT "gate_passes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_facility_id_email_key" ON "users"("facility_id", "email");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_token_hash_idx" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "audit_log_facility_id_table_name_record_id_idx" ON "audit_log"("facility_id", "table_name", "record_id");

-- CreateIndex
CREATE INDEX "audit_log_changed_at_idx" ON "audit_log"("changed_at");

-- CreateIndex
CREATE INDEX "parties_facility_id_phone_primary_idx" ON "parties"("facility_id", "phone_primary");

-- CreateIndex
CREATE INDEX "parties_facility_id_party_type_idx" ON "parties"("facility_id", "party_type");

-- CreateIndex
CREATE INDEX "parties_parent_arhti_id_idx" ON "parties"("parent_arhti_id");

-- CreateIndex
CREATE UNIQUE INDEX "commodities_name_key" ON "commodities"("name");

-- CreateIndex
CREATE INDEX "temperature_logs_chamber_id_recorded_at_idx" ON "temperature_logs"("chamber_id", "recorded_at");

-- CreateIndex
CREATE INDEX "rate_plans_facility_id_is_active_idx" ON "rate_plans"("facility_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "service_charges_facility_id_name_key" ON "service_charges"("facility_id", "name");

-- CreateIndex
CREATE INDEX "lots_facility_id_status_idx" ON "lots"("facility_id", "status");

-- CreateIndex
CREATE INDEX "lots_owner_party_id_status_idx" ON "lots"("owner_party_id", "status");

-- CreateIndex
CREATE INDEX "lots_chamber_id_status_idx" ON "lots"("chamber_id", "status");

-- CreateIndex
CREATE INDEX "lots_inbound_date_idx" ON "lots"("inbound_date");

-- CreateIndex
CREATE INDEX "lots_facility_id_status_inbound_date_idx" ON "lots"("facility_id", "status", "inbound_date");

-- CreateIndex
CREATE INDEX "lots_facility_id_marka_idx" ON "lots"("facility_id", "marka");

-- CreateIndex
CREATE UNIQUE INDEX "lots_facility_id_lot_number_key" ON "lots"("facility_id", "lot_number");

-- CreateIndex
CREATE INDEX "ownership_history_lot_id_effective_date_idx" ON "ownership_history"("lot_id", "effective_date");

-- CreateIndex
CREATE INDEX "outbound_events_lot_id_idx" ON "outbound_events"("lot_id");

-- CreateIndex
CREATE INDEX "outbound_events_facility_id_status_idx" ON "outbound_events"("facility_id", "status");

-- CreateIndex
CREATE INDEX "outbound_events_facility_id_outbound_date_status_idx" ON "outbound_events"("facility_id", "outbound_date", "status");

-- CreateIndex
CREATE UNIQUE INDEX "outbound_events_facility_id_dispatch_note_number_key" ON "outbound_events"("facility_id", "dispatch_note_number");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_outbound_event_id_key" ON "invoices"("outbound_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_journal_entry_id_key" ON "invoices"("journal_entry_id");

-- CreateIndex
CREATE INDEX "invoices_facility_id_invoice_number_idx" ON "invoices"("facility_id", "invoice_number");

-- CreateIndex
CREATE INDEX "invoices_facility_id_status_idx" ON "invoices"("facility_id", "status");

-- CreateIndex
CREATE INDEX "invoices_billing_party_id_status_idx" ON "invoices"("billing_party_id", "status");

-- CreateIndex
CREATE INDEX "invoices_lot_id_idx" ON "invoices"("lot_id");

-- CreateIndex
CREATE INDEX "invoices_invoice_date_idx" ON "invoices"("invoice_date");

-- CreateIndex
CREATE INDEX "invoices_facility_id_status_invoice_date_idx" ON "invoices"("facility_id", "status", "invoice_date");

-- CreateIndex
CREATE INDEX "invoices_facility_id_billing_party_id_status_idx" ON "invoices"("facility_id", "billing_party_id", "status");

-- CreateIndex
CREATE INDEX "invoice_line_items_invoice_id_idx" ON "invoice_line_items"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_journal_entry_id_key" ON "payments"("journal_entry_id");

-- CreateIndex
CREATE INDEX "payments_facility_id_party_id_idx" ON "payments"("facility_id", "party_id");

-- CreateIndex
CREATE INDEX "payments_facility_id_status_idx" ON "payments"("facility_id", "status");

-- CreateIndex
CREATE INDEX "payments_facility_id_payment_date_idx" ON "payments"("facility_id", "payment_date");

-- CreateIndex
CREATE INDEX "payments_facility_id_payment_date_status_idx" ON "payments"("facility_id", "payment_date", "status");

-- CreateIndex
CREATE INDEX "payment_allocations_payment_id_idx" ON "payment_allocations"("payment_id");

-- CreateIndex
CREATE INDEX "payment_allocations_invoice_id_idx" ON "payment_allocations"("invoice_id");

-- CreateIndex
CREATE INDEX "payment_allocations_loan_id_idx" ON "payment_allocations"("loan_id");

-- CreateIndex
CREATE INDEX "chart_of_accounts_facility_id_account_class_idx" ON "chart_of_accounts"("facility_id", "account_class");

-- CreateIndex
CREATE UNIQUE INDEX "chart_of_accounts_facility_id_account_code_key" ON "chart_of_accounts"("facility_id", "account_code");

-- CreateIndex
CREATE INDEX "journal_entries_facility_id_entry_date_idx" ON "journal_entries"("facility_id", "entry_date");

-- CreateIndex
CREATE INDEX "journal_entries_facility_id_entry_type_idx" ON "journal_entries"("facility_id", "entry_type");

-- CreateIndex
CREATE INDEX "journal_entries_facility_id_period_year_period_month_idx" ON "journal_entries"("facility_id", "period_year", "period_month");

-- CreateIndex
CREATE INDEX "journal_entries_source_table_source_id_idx" ON "journal_entries"("source_table", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_facility_id_entry_number_key" ON "journal_entries"("facility_id", "entry_number");

-- CreateIndex
CREATE INDEX "journal_entry_lines_journal_entry_id_idx" ON "journal_entry_lines"("journal_entry_id");

-- CreateIndex
CREATE INDEX "journal_entry_lines_facility_id_account_code_idx" ON "journal_entry_lines"("facility_id", "account_code");

-- CreateIndex
CREATE INDEX "journal_entry_lines_party_id_idx" ON "journal_entry_lines"("party_id");

-- CreateIndex
CREATE INDEX "journal_entry_lines_lot_id_idx" ON "journal_entry_lines"("lot_id");

-- CreateIndex
CREATE UNIQUE INDEX "credit_notes_journal_entry_id_key" ON "credit_notes"("journal_entry_id");

-- CreateIndex
CREATE INDEX "credit_notes_facility_id_status_idx" ON "credit_notes"("facility_id", "status");

-- CreateIndex
CREATE INDEX "credit_notes_original_invoice_id_idx" ON "credit_notes"("original_invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "credit_notes_facility_id_credit_note_number_key" ON "credit_notes"("facility_id", "credit_note_number");

-- CreateIndex
CREATE INDEX "credit_note_line_items_credit_note_id_idx" ON "credit_note_line_items"("credit_note_id");

-- CreateIndex
CREATE UNIQUE INDEX "period_locks_facility_id_period_year_period_month_key" ON "period_locks"("facility_id", "period_year", "period_month");

-- CreateIndex
CREATE UNIQUE INDEX "fixed_assets_purchase_journal_entry_id_key" ON "fixed_assets"("purchase_journal_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "fixed_assets_disposal_journal_entry_id_key" ON "fixed_assets"("disposal_journal_entry_id");

-- CreateIndex
CREATE INDEX "fixed_assets_facility_id_status_idx" ON "fixed_assets"("facility_id", "status");

-- CreateIndex
CREATE INDEX "fixed_assets_facility_id_asset_category_idx" ON "fixed_assets"("facility_id", "asset_category");

-- CreateIndex
CREATE UNIQUE INDEX "fixed_assets_facility_id_asset_number_key" ON "fixed_assets"("facility_id", "asset_number");

-- CreateIndex
CREATE INDEX "depreciation_schedules_period_year_period_month_status_idx" ON "depreciation_schedules"("period_year", "period_month", "status");

-- CreateIndex
CREATE UNIQUE INDEX "depreciation_schedules_fixed_asset_id_period_year_period_mo_key" ON "depreciation_schedules"("fixed_asset_id", "period_year", "period_month");

-- CreateIndex
CREATE INDEX "employees_facility_id_is_active_idx" ON "employees"("facility_id", "is_active");

-- CreateIndex
CREATE INDEX "employees_facility_id_employee_type_idx" ON "employees"("facility_id", "employee_type");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_runs_payroll_journal_entry_id_key" ON "payroll_runs"("payroll_journal_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_runs_payment_journal_entry_id_key" ON "payroll_runs"("payment_journal_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_runs_remittance_journal_entry_id_key" ON "payroll_runs"("remittance_journal_entry_id");

-- CreateIndex
CREATE INDEX "payroll_runs_facility_id_status_idx" ON "payroll_runs"("facility_id", "status");

-- CreateIndex
CREATE INDEX "payroll_runs_facility_id_period_year_period_month_idx" ON "payroll_runs"("facility_id", "period_year", "period_month");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_runs_facility_id_run_number_key" ON "payroll_runs"("facility_id", "run_number");

-- CreateIndex
CREATE INDEX "payroll_line_items_payroll_run_id_idx" ON "payroll_line_items"("payroll_run_id");

-- CreateIndex
CREATE UNIQUE INDEX "expense_vouchers_accrual_journal_entry_id_key" ON "expense_vouchers"("accrual_journal_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "expense_vouchers_payment_journal_entry_id_key" ON "expense_vouchers"("payment_journal_entry_id");

-- CreateIndex
CREATE INDEX "expense_vouchers_facility_id_status_idx" ON "expense_vouchers"("facility_id", "status");

-- CreateIndex
CREATE INDEX "expense_vouchers_facility_id_voucher_date_idx" ON "expense_vouchers"("facility_id", "voucher_date");

-- CreateIndex
CREATE UNIQUE INDEX "expense_vouchers_facility_id_voucher_number_key" ON "expense_vouchers"("facility_id", "voucher_number");

-- CreateIndex
CREATE UNIQUE INDEX "party_loans_issue_journal_entry_id_key" ON "party_loans"("issue_journal_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "party_loans_write_off_journal_entry_id_key" ON "party_loans"("write_off_journal_entry_id");

-- CreateIndex
CREATE INDEX "party_loans_facility_id_party_id_idx" ON "party_loans"("facility_id", "party_id");

-- CreateIndex
CREATE INDEX "party_loans_facility_id_status_idx" ON "party_loans"("facility_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "party_loans_facility_id_loan_number_key" ON "party_loans"("facility_id", "loan_number");

-- CreateIndex
CREATE UNIQUE INDEX "party_loan_repayments_journal_entry_id_key" ON "party_loan_repayments"("journal_entry_id");

-- CreateIndex
CREATE INDEX "party_loan_repayments_loan_id_idx" ON "party_loan_repayments"("loan_id");

-- CreateIndex
CREATE INDEX "party_loan_repayments_payment_id_idx" ON "party_loan_repayments"("payment_id");

-- CreateIndex
CREATE INDEX "gate_passes_facility_id_status_idx" ON "gate_passes"("facility_id", "status");

-- CreateIndex
CREATE INDEX "gate_passes_facility_id_vehicle_number_idx" ON "gate_passes"("facility_id", "vehicle_number");

-- CreateIndex
CREATE INDEX "gate_passes_related_lot_id_idx" ON "gate_passes"("related_lot_id");

-- CreateIndex
CREATE INDEX "gate_passes_related_outbound_id_idx" ON "gate_passes"("related_outbound_id");

-- CreateIndex
CREATE INDEX "gate_passes_party_id_idx" ON "gate_passes"("party_id");

-- CreateIndex
CREATE UNIQUE INDEX "gate_passes_facility_id_pass_number_key" ON "gate_passes"("facility_id", "pass_number");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parties" ADD CONSTRAINT "parties_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parties" ADD CONSTRAINT "parties_parent_arhti_id_fkey" FOREIGN KEY ("parent_arhti_id") REFERENCES "parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parties" ADD CONSTRAINT "parties_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "varieties" ADD CONSTRAINT "varieties_commodity_id_fkey" FOREIGN KEY ("commodity_id") REFERENCES "commodities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chambers" ADD CONSTRAINT "chambers_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chambers" ADD CONSTRAINT "chambers_commodity_restriction_fkey" FOREIGN KEY ("commodity_restriction") REFERENCES "commodities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "temperature_logs" ADD CONSTRAINT "temperature_logs_chamber_id_fkey" FOREIGN KEY ("chamber_id") REFERENCES "chambers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "temperature_logs" ADD CONSTRAINT "temperature_logs_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rate_plans" ADD CONSTRAINT "rate_plans_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rate_plans" ADD CONSTRAINT "rate_plans_commodity_id_fkey" FOREIGN KEY ("commodity_id") REFERENCES "commodities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_charges" ADD CONSTRAINT "service_charges_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_chamber_id_fkey" FOREIGN KEY ("chamber_id") REFERENCES "chambers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_owner_party_id_fkey" FOREIGN KEY ("owner_party_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_billing_party_id_fkey" FOREIGN KEY ("billing_party_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_commodity_id_fkey" FOREIGN KEY ("commodity_id") REFERENCES "commodities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_variety_id_fkey" FOREIGN KEY ("variety_id") REFERENCES "varieties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_rate_plan_id_fkey" FOREIGN KEY ("rate_plan_id") REFERENCES "rate_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_parent_lot_id_fkey" FOREIGN KEY ("parent_lot_id") REFERENCES "lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ownership_history" ADD CONSTRAINT "ownership_history_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ownership_history" ADD CONSTRAINT "ownership_history_from_party_id_fkey" FOREIGN KEY ("from_party_id") REFERENCES "parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ownership_history" ADD CONSTRAINT "ownership_history_to_party_id_fkey" FOREIGN KEY ("to_party_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ownership_history" ADD CONSTRAINT "ownership_history_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_events" ADD CONSTRAINT "outbound_events_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_events" ADD CONSTRAINT "outbound_events_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_events" ADD CONSTRAINT "outbound_events_receiving_party_id_fkey" FOREIGN KEY ("receiving_party_id") REFERENCES "parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_events" ADD CONSTRAINT "outbound_events_owner_party_id_snapshot_fkey" FOREIGN KEY ("owner_party_id_snapshot") REFERENCES "parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_events" ADD CONSTRAINT "outbound_events_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_outbound_event_id_fkey" FOREIGN KEY ("outbound_event_id") REFERENCES "outbound_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_billing_party_id_fkey" FOREIGN KEY ("billing_party_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_finalized_by_fkey" FOREIGN KEY ("finalized_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_service_charge_id_fkey" FOREIGN KEY ("service_charge_id") REFERENCES "service_charges"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_rate_plan_id_fkey" FOREIGN KEY ("rate_plan_id") REFERENCES "rate_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_loan_id_fkey" FOREIGN KEY ("loan_id") REFERENCES "party_loans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chart_of_accounts" ADD CONSTRAINT "chart_of_accounts_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reversed_by_fkey" FOREIGN KEY ("reversed_by") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_facility_id_account_code_fkey" FOREIGN KEY ("facility_id", "account_code") REFERENCES "chart_of_accounts"("facility_id", "account_code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_original_invoice_id_fkey" FOREIGN KEY ("original_invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_billing_party_id_fkey" FOREIGN KEY ("billing_party_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note_line_items" ADD CONSTRAINT "credit_note_line_items_credit_note_id_fkey" FOREIGN KEY ("credit_note_id") REFERENCES "credit_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "period_locks" ADD CONSTRAINT "period_locks_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "period_locks" ADD CONSTRAINT "period_locks_locked_by_fkey" FOREIGN KEY ("locked_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "period_locks" ADD CONSTRAINT "period_locks_unlocked_by_fkey" FOREIGN KEY ("unlocked_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_purchase_journal_entry_id_fkey" FOREIGN KEY ("purchase_journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_disposal_journal_entry_id_fkey" FOREIGN KEY ("disposal_journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "depreciation_schedules" ADD CONSTRAINT "depreciation_schedules_fixed_asset_id_fkey" FOREIGN KEY ("fixed_asset_id") REFERENCES "fixed_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "depreciation_schedules" ADD CONSTRAINT "depreciation_schedules_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_finalized_by_fkey" FOREIGN KEY ("finalized_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_payroll_journal_entry_id_fkey" FOREIGN KEY ("payroll_journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_payment_journal_entry_id_fkey" FOREIGN KEY ("payment_journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_remittance_journal_entry_id_fkey" FOREIGN KEY ("remittance_journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_line_items" ADD CONSTRAINT "payroll_line_items_payroll_run_id_fkey" FOREIGN KEY ("payroll_run_id") REFERENCES "payroll_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_line_items" ADD CONSTRAINT "payroll_line_items_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_vouchers" ADD CONSTRAINT "expense_vouchers_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_vouchers" ADD CONSTRAINT "expense_vouchers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_vouchers" ADD CONSTRAINT "expense_vouchers_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_vouchers" ADD CONSTRAINT "expense_vouchers_accrual_journal_entry_id_fkey" FOREIGN KEY ("accrual_journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_vouchers" ADD CONSTRAINT "expense_vouchers_payment_journal_entry_id_fkey" FOREIGN KEY ("payment_journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "party_loans" ADD CONSTRAINT "party_loans_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "party_loans" ADD CONSTRAINT "party_loans_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "party_loans" ADD CONSTRAINT "party_loans_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "party_loans" ADD CONSTRAINT "party_loans_issue_journal_entry_id_fkey" FOREIGN KEY ("issue_journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "party_loans" ADD CONSTRAINT "party_loans_write_off_journal_entry_id_fkey" FOREIGN KEY ("write_off_journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "party_loan_repayments" ADD CONSTRAINT "party_loan_repayments_loan_id_fkey" FOREIGN KEY ("loan_id") REFERENCES "party_loans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "party_loan_repayments" ADD CONSTRAINT "party_loan_repayments_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "party_loan_repayments" ADD CONSTRAINT "party_loan_repayments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "party_loan_repayments" ADD CONSTRAINT "party_loan_repayments_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gate_passes" ADD CONSTRAINT "gate_passes_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gate_passes" ADD CONSTRAINT "gate_passes_related_lot_id_fkey" FOREIGN KEY ("related_lot_id") REFERENCES "lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gate_passes" ADD CONSTRAINT "gate_passes_related_outbound_id_fkey" FOREIGN KEY ("related_outbound_id") REFERENCES "outbound_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gate_passes" ADD CONSTRAINT "gate_passes_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gate_passes" ADD CONSTRAINT "gate_passes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ============================================================
-- Custom database objects (audit triggers + Row-Level Security).
-- Prisma does not model these, so they are appended to the baseline to faithfully
-- reproduce the live schema: audit logging on facilities/users and facility-isolation
-- RLS on the four foundation tables. (Operational tables rely on application-level
-- facility scoping; extending audit/RLS coverage is a separate task.)
-- ============================================================

-- Per-tenant audit function: facility_id from the row, else the app.facility_id GUC.
-- Safe on empty/unset session vars (empty string cannot cast to uuid).
CREATE OR REPLACE FUNCTION audit_trigger_fn()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_user_id uuid;
  v_facility_id uuid;
  v_raw text;
BEGIN
  v_raw := current_setting('app.user_id', true);
  IF v_raw IS NOT NULL AND v_raw <> '' THEN
    v_user_id := v_raw::uuid;
  ELSE
    v_user_id := '00000000-0000-0000-0000-000000000000'::uuid;
  END IF;

  IF NEW.facility_id IS NOT NULL THEN
    v_facility_id := NEW.facility_id;
  ELSE
    v_raw := current_setting('app.facility_id', true);
    IF v_raw IS NOT NULL AND v_raw <> '' THEN
      v_facility_id := v_raw::uuid;
    ELSE
      v_facility_id := '00000000-0000-0000-0000-000000000000'::uuid;
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_log (id, facility_id, table_name, record_id, action, changed_by, changed_at, old_values, new_values)
    VALUES (gen_random_uuid(), v_facility_id, TG_TABLE_NAME, NEW.id, 'INSERT', v_user_id, NOW(), NULL, to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO audit_log (id, facility_id, table_name, record_id, action, changed_by, changed_at, old_values, new_values)
    VALUES (gen_random_uuid(), v_facility_id, TG_TABLE_NAME, NEW.id, 'UPDATE', v_user_id, NOW(), to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$;

-- Self-facility variant for the `facilities` table, where the row's own id IS the facility_id.
CREATE OR REPLACE FUNCTION audit_trigger_self_facility_fn() RETURNS TRIGGER AS $$
DECLARE
  v_user_id uuid;
  v_raw_user text;
BEGIN
  v_raw_user := current_setting('app.user_id', true);
  IF v_raw_user IS NOT NULL AND v_raw_user <> '' THEN
    v_user_id := v_raw_user::uuid;
  ELSE
    v_user_id := '00000000-0000-0000-0000-000000000000'::uuid;
  END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_log (id, facility_id, table_name, record_id, action, changed_by, changed_at, old_values, new_values)
    VALUES (gen_random_uuid(), NEW.id, TG_TABLE_NAME, NEW.id, 'INSERT', v_user_id, NOW(), NULL, to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO audit_log (id, facility_id, table_name, record_id, action, changed_by, changed_at, old_values, new_values)
    VALUES (gen_random_uuid(), NEW.id, TG_TABLE_NAME, NEW.id, 'UPDATE', v_user_id, NOW(), to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Audit triggers (facilities uses the self-facility function).
CREATE OR REPLACE TRIGGER audit_users
  AFTER INSERT OR UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

CREATE OR REPLACE TRIGGER audit_facilities
  AFTER INSERT OR UPDATE ON facilities
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_self_facility_fn();

-- Row-Level Security: facility isolation on foundation tables via the app.facility_id GUC.
ALTER TABLE facilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY facility_isolation ON facilities
  FOR ALL USING (id = current_setting('app.facility_id', true)::uuid);
CREATE POLICY user_facility_isolation ON users
  FOR ALL USING (facility_id = current_setting('app.facility_id', true)::uuid);
CREATE POLICY refresh_token_facility_isolation ON refresh_tokens
  FOR ALL USING (facility_id = current_setting('app.facility_id', true)::uuid);
CREATE POLICY audit_log_facility_isolation ON audit_log
  FOR ALL USING (facility_id = current_setting('app.facility_id', true)::uuid);
