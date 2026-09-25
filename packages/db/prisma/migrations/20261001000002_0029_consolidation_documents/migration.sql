-- 0029 — Every table and column the accounting consolidation needs (docs/25 §9).
--
-- All schema for the whole program lands in this one release so the parallel
-- work streams never touch the migrations folder. Strictly additive: update.ps1
-- rolls back the *image*, never the database, so an older image must keep
-- working against this schema — every new column is nullable or defaulted, and
-- where a value is derived (a party's control account) a BEFORE INSERT trigger
-- fills it for rows an older image creates. Release 2 makes those NOT NULL and
-- drops the triggers.

-- ---------------------------------------------------------------------------
-- 1. Parties: a per-party control account (docs/25 R-01, decision Q1).
--
-- The AR account used to be looked up from the party's *current* type on every
-- posting, and the type is editable — so retyping a farmer as a trader split its
-- receivable across 1110 and 1120. It is now stamped once, when the party is
-- created, and the app refuses to change it after the first posting.
-- ---------------------------------------------------------------------------
ALTER TABLE "parties"
  ADD COLUMN "control_account_code" VARCHAR(10),
  ADD COLUMN "ntn"                  VARCHAR(20),
  ADD COLUMN "is_atl_filer"         BOOLEAN NOT NULL DEFAULT false;

UPDATE "parties"
   SET "control_account_code" = CASE "party_type"::text
         WHEN 'FARMER'   THEN '1110'
         WHEN 'TRADER'   THEN '1120'
         WHEN 'ARHTI'    THEN '1130'
         WHEN 'SUPPLIER' THEN '2050'
         ELSE '1150'
       END
 WHERE "control_account_code" IS NULL;

-- Mirrors DEFAULT_CONTROL_ACCOUNT_BY_PARTY_TYPE in @coldchain/shared. Only for
-- rows an older image inserts during a rollback; the current app always sets it.
CREATE OR REPLACE FUNCTION parties_default_control_account_fn()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.control_account_code IS NULL THEN
    NEW.control_account_code := CASE NEW.party_type::text
      WHEN 'FARMER'   THEN '1110'
      WHEN 'TRADER'   THEN '1120'
      WHEN 'ARHTI'    THEN '1130'
      WHEN 'SUPPLIER' THEN '2050'
      ELSE '1150'
    END;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER parties_default_control_account
  BEFORE INSERT ON "parties"
  FOR EACH ROW EXECUTE FUNCTION parties_default_control_account_fn();

-- An owner's CNIC, so payroll can refuse to employ an owner (docs/25 C-21): an
-- owner's pay is a drawing, never a salary.
ALTER TABLE "partners" ADD COLUMN "cnic" VARCHAR(15);

-- ---------------------------------------------------------------------------
-- 2. Revenue routing stamped on the configuration, not looked up by name
--    (docs/25 L-28). A rate plan may name its own revenue account; otherwise the
--    lot's commodity does. Before this the commodity's account was found by its
--    upper-cased NAME at posting time, so renaming a commodity re-routed revenue.
-- ---------------------------------------------------------------------------
ALTER TABLE "commodities" ADD COLUMN "revenue_account_code" VARCHAR(10);

UPDATE "commodities"
   SET "revenue_account_code" = CASE upper("name")
         WHEN 'POTATO' THEN '4010'
         WHEN 'APPLE'  THEN '4020'
         WHEN 'ONION'  THEN '4030'
         WHEN 'KINNOW' THEN '4040'
         ELSE '4050'
       END
 WHERE "revenue_account_code" IS NULL;

CREATE OR REPLACE FUNCTION commodities_default_revenue_account_fn()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.revenue_account_code IS NULL THEN
    NEW.revenue_account_code := CASE upper(NEW.name)
      WHEN 'POTATO' THEN '4010'
      WHEN 'APPLE'  THEN '4020'
      WHEN 'ONION'  THEN '4030'
      WHEN 'KINNOW' THEN '4040'
      ELSE '4050'
    END;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER commodities_default_revenue_account
  BEFORE INSERT ON "commodities"
  FOR EACH ROW EXECUTE FUNCTION commodities_default_revenue_account_fn();

-- A service line with no account of its own used to fall back to 4150 inside
-- the posting template; the default belongs on the row.
UPDATE "service_charges" SET "revenue_account_code" = '4150' WHERE "revenue_account_code" IS NULL;
ALTER TABLE "service_charges" ALTER COLUMN "revenue_account_code" SET DEFAULT '4150';

-- ---------------------------------------------------------------------------
-- 3. Employees: which cost account their pay lands in (docs/25 C-16). It used to
--    follow how they are PAID (salaried -> overhead, daily -> direct), so a
--    salaried plant operator landed in overheads and gross profit was wrong.
-- ---------------------------------------------------------------------------
ALTER TABLE "employees" ADD COLUMN "cost_account_code" VARCHAR(10);

UPDATE "employees"
   SET "cost_account_code" = CASE "employee_type"::text WHEN 'DAILY_WAGE' THEN '5030' ELSE '6010' END
 WHERE "cost_account_code" IS NULL;

CREATE OR REPLACE FUNCTION employees_default_cost_account_fn()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.cost_account_code IS NULL THEN
    NEW.cost_account_code := CASE NEW.employee_type::text WHEN 'DAILY_WAGE' THEN '5030' ELSE '6010' END;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER employees_default_cost_account
  BEFORE INSERT ON "employees"
  FOR EACH ROW EXECUTE FUNCTION employees_default_cost_account_fn();

-- ---------------------------------------------------------------------------
-- 4. Structured cancellation instead of tags appended to `notes`
--    (docs/25 R-24, C-39). The reversing journal entry still carries the reason
--    in its description; these let the document itself say so.
-- ---------------------------------------------------------------------------
ALTER TABLE "invoices"
  ADD COLUMN "voided_at"   TIMESTAMPTZ,
  ADD COLUMN "voided_by"   UUID REFERENCES "users"("id"),
  ADD COLUMN "void_reason" TEXT,
  -- A late-payment surcharge is its own invoice, pointing at the overdue one
  -- (docs/25 R-08), so it settles, credits and voids like any other charge.
  ADD COLUMN "surcharge_of_invoice_id" UUID REFERENCES "invoices"("id");

CREATE INDEX "invoices_surcharge_of_invoice_id_idx" ON "invoices" ("surcharge_of_invoice_id");

ALTER TABLE "credit_notes"
  ADD COLUMN "gst_amount_pkr" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "voided_at"      TIMESTAMPTZ,
  ADD COLUMN "voided_by"      UUID REFERENCES "users"("id"),
  ADD COLUMN "void_reason"    TEXT;

-- Which invoice line a credit-note line reverses, so the revenue account and the
-- GST come from the invoice rather than the request (docs/25 R-03).
ALTER TABLE "credit_note_line_items"
  ADD COLUMN "invoice_line_item_id" UUID REFERENCES "invoice_line_items"("id");

ALTER TABLE "payroll_runs"
  ADD COLUMN "voided_at"   TIMESTAMPTZ,
  ADD COLUMN "voided_by"   UUID REFERENCES "users"("id"),
  ADD COLUMN "void_reason" TEXT;

ALTER TABLE "fixed_assets"
  -- Brought onto the register at go-live: its cost and accumulated depreciation
  -- are already in the opening-balance entry, so it has no purchase entry of its
  -- own (docs/25 C-30).
  ADD COLUMN "is_opening_balance" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "voided_at"          TIMESTAMPTZ,
  ADD COLUMN "voided_by"          UUID REFERENCES "users"("id"),
  ADD COLUMN "void_reason"        TEXT;

-- A draft journal entry takes its number when it is posted, not when it is saved,
-- so deleting a draft can no longer leave a gap or free a number for reuse
-- (docs/25 L-13). The unique index already treats NULLs as distinct.
ALTER TABLE "journal_entries" ALTER COLUMN "entry_number" DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. Payables (docs/25 C-01, decision Q3).
-- ---------------------------------------------------------------------------
CREATE TYPE "BillStatus" AS ENUM ('DRAFT', 'POSTED', 'VOID');
CREATE TYPE "WithholdingSection" AS ENUM ('S149', 'S153', 'S155');

CREATE TABLE "bills" (
  "id"                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "facility_id"               UUID NOT NULL REFERENCES "facilities"("id"),
  "bill_number"               VARCHAR(20),
  "supplier_party_id"         UUID NOT NULL REFERENCES "parties"("id"),
  "bill_date"                 DATE NOT NULL,
  "due_date"                  DATE,
  "supplier_reference"        VARCHAR(100),
  "description"               VARCHAR(500) NOT NULL,
  "subtotal_pkr"              DECIMAL(14,2) NOT NULL,
  "input_tax_pkr"             DECIMAL(14,2) NOT NULL DEFAULT 0,
  "total_pkr"                 DECIMAL(14,2) NOT NULL,
  "status"                    "BillStatus" NOT NULL DEFAULT 'DRAFT',
  "book_type"                 "BookType" NOT NULL DEFAULT 'PACCI',
  "journal_entry_id"          UUID UNIQUE REFERENCES "journal_entries"("id"),
  "legacy_expense_voucher_id" UUID UNIQUE REFERENCES "expense_vouchers"("id"),
  "voided_at"                 TIMESTAMPTZ,
  "voided_by"                 UUID REFERENCES "users"("id"),
  "void_reason"               TEXT,
  "notes"                     TEXT,
  "created_at"                TIMESTAMPTZ NOT NULL DEFAULT now(),
  "created_by"                UUID NOT NULL REFERENCES "users"("id"),
  CONSTRAINT "bills_amounts_nonnegative" CHECK ("subtotal_pkr" >= 0 AND "input_tax_pkr" >= 0),
  CONSTRAINT "bills_total_is_sum" CHECK ("total_pkr" = "subtotal_pkr" + "input_tax_pkr")
);
CREATE UNIQUE INDEX "bills_facility_number_key" ON "bills" ("facility_id", "bill_number");
CREATE INDEX "bills_facility_supplier_idx" ON "bills" ("facility_id", "supplier_party_id");
CREATE INDEX "bills_facility_status_idx" ON "bills" ("facility_id", "status");
CREATE INDEX "bills_facility_date_idx" ON "bills" ("facility_id", "bill_date");

CREATE TABLE "bill_lines" (
  "id"                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "bill_id"              UUID NOT NULL REFERENCES "bills"("id") ON DELETE CASCADE,
  "facility_id"          UUID NOT NULL REFERENCES "facilities"("id"),
  "line_number"          INT NOT NULL,
  "expense_account_code" VARCHAR(10) NOT NULL,
  "description"          VARCHAR(300) NOT NULL,
  "amount_pkr"           DECIMAL(14,2) NOT NULL,
  CONSTRAINT "bill_lines_amount_positive" CHECK ("amount_pkr" > 0),
  CONSTRAINT "bill_lines_account_fkey" FOREIGN KEY ("facility_id", "expense_account_code")
    REFERENCES "chart_of_accounts" ("facility_id", "account_code") ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "bill_lines_bill_line_key" ON "bill_lines" ("bill_id", "line_number");

CREATE TABLE "supplier_payments" (
  "id"                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "facility_id"          UUID NOT NULL REFERENCES "facilities"("id"),
  "payment_number"       VARCHAR(20),
  "supplier_party_id"    UUID NOT NULL REFERENCES "parties"("id"),
  "payment_date"         DATE NOT NULL,
  "payment_method"       "PaymentMethod" NOT NULL,
  "asset_account_code"   VARCHAR(10) NOT NULL,
  -- What the payment settles on the supplier's account. The supplier receives
  -- gross less the tax withheld; the withheld part is owed to the FBR instead.
  "gross_amount_pkr"     DECIMAL(14,2) NOT NULL,
  "withholding_section"  "WithholdingSection",
  "withholding_rate_pct" DECIMAL(5,2),
  "withholding_pkr"      DECIMAL(14,2) NOT NULL DEFAULT 0,
  "net_paid_pkr"         DECIMAL(14,2) NOT NULL,
  "certificate_number"   VARCHAR(50),
  "reference_number"     VARCHAR(100),
  "book_type"            "BookType" NOT NULL DEFAULT 'PACCI',
  "journal_entry_id"     UUID UNIQUE REFERENCES "journal_entries"("id"),
  "voided_at"            TIMESTAMPTZ,
  "voided_by"            UUID REFERENCES "users"("id"),
  "void_reason"          TEXT,
  "notes"                TEXT,
  "created_at"           TIMESTAMPTZ NOT NULL DEFAULT now(),
  "created_by"           UUID NOT NULL REFERENCES "users"("id"),
  CONSTRAINT "supplier_payments_gross_positive" CHECK ("gross_amount_pkr" > 0),
  CONSTRAINT "supplier_payments_withholding_range" CHECK ("withholding_pkr" >= 0 AND "withholding_pkr" < "gross_amount_pkr"),
  CONSTRAINT "supplier_payments_net_is_difference" CHECK ("net_paid_pkr" = "gross_amount_pkr" - "withholding_pkr"),
  CONSTRAINT "supplier_payments_withholding_needs_section" CHECK ("withholding_pkr" = 0 OR "withholding_section" IS NOT NULL),
  CONSTRAINT "supplier_payments_account_fkey" FOREIGN KEY ("facility_id", "asset_account_code")
    REFERENCES "chart_of_accounts" ("facility_id", "account_code") ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "supplier_payments_facility_number_key" ON "supplier_payments" ("facility_id", "payment_number");
CREATE INDEX "supplier_payments_facility_supplier_idx" ON "supplier_payments" ("facility_id", "supplier_party_id");
CREATE INDEX "supplier_payments_facility_date_idx" ON "supplier_payments" ("facility_id", "payment_date");

CREATE TABLE "supplier_payment_allocations" (
  "id"                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "supplier_payment_id"  UUID NOT NULL REFERENCES "supplier_payments"("id"),
  "bill_id"              UUID NOT NULL REFERENCES "bills"("id"),
  "allocated_amount_pkr" DECIMAL(14,2) NOT NULL,
  "voided_at"            TIMESTAMPTZ,
  "voided_by"            UUID REFERENCES "users"("id"),
  CONSTRAINT "supplier_payment_allocations_amount_positive" CHECK ("allocated_amount_pkr" > 0)
);
CREATE INDEX "supplier_payment_allocations_payment_idx" ON "supplier_payment_allocations" ("supplier_payment_id");
CREATE INDEX "supplier_payment_allocations_bill_idx" ON "supplier_payment_allocations" ("bill_id");

-- ---------------------------------------------------------------------------
-- 6. Statutory remittances as documents (docs/25 C-10): one period-based record
--    per liability account paid over — EOBI (2060/2061), s.149 (2070), s.153
--    (2071), s.155 (2072) — replacing per-payroll-run remittance and the
--    document-less JE-29.
-- ---------------------------------------------------------------------------
CREATE TABLE "tax_remittances" (
  "id"                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "facility_id"            UUID NOT NULL REFERENCES "facilities"("id"),
  "liability_account_code" VARCHAR(10) NOT NULL,
  "period_year"            INT NOT NULL,
  "period_month"           INT NOT NULL,
  "remittance_date"        DATE NOT NULL,
  "amount_pkr"             DECIMAL(14,2) NOT NULL,
  "paid_from_account_code" VARCHAR(10) NOT NULL,
  -- The FBR / EOBI computerised payment receipt (CPR / challan) number.
  "challan_number"         VARCHAR(50),
  "book_type"              "BookType" NOT NULL DEFAULT 'PACCI',
  "journal_entry_id"       UUID UNIQUE REFERENCES "journal_entries"("id"),
  "voided_at"              TIMESTAMPTZ,
  "voided_by"              UUID REFERENCES "users"("id"),
  "void_reason"            TEXT,
  "notes"                  TEXT,
  "created_at"             TIMESTAMPTZ NOT NULL DEFAULT now(),
  "created_by"             UUID NOT NULL REFERENCES "users"("id"),
  CONSTRAINT "tax_remittances_amount_positive" CHECK ("amount_pkr" > 0),
  CONSTRAINT "tax_remittances_month_range" CHECK ("period_month" BETWEEN 1 AND 12),
  CONSTRAINT "tax_remittances_liability_fkey" FOREIGN KEY ("facility_id", "liability_account_code")
    REFERENCES "chart_of_accounts" ("facility_id", "account_code") ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT "tax_remittances_paid_from_fkey" FOREIGN KEY ("facility_id", "paid_from_account_code")
    REFERENCES "chart_of_accounts" ("facility_id", "account_code") ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE INDEX "tax_remittances_facility_period_idx" ON "tax_remittances" ("facility_id", "liability_account_code", "period_year", "period_month");

-- ---------------------------------------------------------------------------
-- 7. Cash transfers and owner equity movements as documents (docs/25 L-10,
--    C-44). Both used to be posted straight from the controller with the acting
--    USER's id as the "source document", so they had no history and no void.
-- ---------------------------------------------------------------------------
CREATE TABLE "cash_transfers" (
  "id"                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "facility_id"       UUID NOT NULL REFERENCES "facilities"("id"),
  "transfer_date"     DATE NOT NULL,
  "from_account_code" VARCHAR(10) NOT NULL,
  "to_account_code"   VARCHAR(10) NOT NULL,
  "amount_pkr"        DECIMAL(14,2) NOT NULL,
  "reference"         VARCHAR(100),
  "notes"             TEXT,
  "book_type"         "BookType" NOT NULL DEFAULT 'PACCI',
  "journal_entry_id"  UUID UNIQUE REFERENCES "journal_entries"("id"),
  "voided_at"         TIMESTAMPTZ,
  "voided_by"         UUID REFERENCES "users"("id"),
  "void_reason"       TEXT,
  "created_at"        TIMESTAMPTZ NOT NULL DEFAULT now(),
  "created_by"        UUID NOT NULL REFERENCES "users"("id"),
  CONSTRAINT "cash_transfers_amount_positive" CHECK ("amount_pkr" > 0),
  CONSTRAINT "cash_transfers_distinct_accounts" CHECK ("from_account_code" <> "to_account_code"),
  CONSTRAINT "cash_transfers_from_fkey" FOREIGN KEY ("facility_id", "from_account_code")
    REFERENCES "chart_of_accounts" ("facility_id", "account_code") ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT "cash_transfers_to_fkey" FOREIGN KEY ("facility_id", "to_account_code")
    REFERENCES "chart_of_accounts" ("facility_id", "account_code") ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE INDEX "cash_transfers_facility_date_idx" ON "cash_transfers" ("facility_id", "transfer_date");

CREATE TYPE "OwnerEquityDirection" AS ENUM ('CAPITAL_IN', 'DRAWING');

CREATE TABLE "owner_equity_movements" (
  "id"                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "facility_id"       UUID NOT NULL REFERENCES "facilities"("id"),
  "partner_id"        UUID NOT NULL REFERENCES "partners"("id"),
  "direction"         "OwnerEquityDirection" NOT NULL,
  "movement_date"     DATE NOT NULL,
  "amount_pkr"        DECIMAL(14,2) NOT NULL,
  "cash_account_code" VARCHAR(10) NOT NULL,
  "note"              VARCHAR(300),
  "book_type"         "BookType" NOT NULL DEFAULT 'PACCI',
  "journal_entry_id"  UUID UNIQUE REFERENCES "journal_entries"("id"),
  "voided_at"         TIMESTAMPTZ,
  "voided_by"         UUID REFERENCES "users"("id"),
  "void_reason"       TEXT,
  "created_at"        TIMESTAMPTZ NOT NULL DEFAULT now(),
  "created_by"        UUID NOT NULL REFERENCES "users"("id"),
  CONSTRAINT "owner_equity_movements_amount_positive" CHECK ("amount_pkr" > 0),
  CONSTRAINT "owner_equity_movements_cash_fkey" FOREIGN KEY ("facility_id", "cash_account_code")
    REFERENCES "chart_of_accounts" ("facility_id", "account_code") ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE INDEX "owner_equity_movements_facility_partner_idx" ON "owner_equity_movements" ("facility_id", "partner_id");

-- ---------------------------------------------------------------------------
-- 8. Audit the new financial tables and the partner tables (docs/25 L-25), and
--    let the test-harness toggle reach them.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE TRIGGER audit_bills
  AFTER INSERT OR UPDATE OR DELETE ON "bills"
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE OR REPLACE TRIGGER audit_bill_lines
  AFTER INSERT OR UPDATE OR DELETE ON "bill_lines"
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE OR REPLACE TRIGGER audit_supplier_payments
  AFTER INSERT OR UPDATE OR DELETE ON "supplier_payments"
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE OR REPLACE TRIGGER audit_supplier_payment_allocations
  AFTER INSERT OR UPDATE OR DELETE ON "supplier_payment_allocations"
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn('supplier_payments', 'supplier_payment_id');
CREATE OR REPLACE TRIGGER audit_tax_remittances
  AFTER INSERT OR UPDATE OR DELETE ON "tax_remittances"
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE OR REPLACE TRIGGER audit_cash_transfers
  AFTER INSERT OR UPDATE OR DELETE ON "cash_transfers"
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE OR REPLACE TRIGGER audit_owner_equity_movements
  AFTER INSERT OR UPDATE OR DELETE ON "owner_equity_movements"
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE OR REPLACE TRIGGER audit_partners
  AFTER INSERT OR UPDATE OR DELETE ON "partners"
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE OR REPLACE TRIGGER audit_partner_profit_shares
  AFTER INSERT OR UPDATE OR DELETE ON "partner_profit_shares"
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

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
                        'credit_notes', 'expense_vouchers', 'party_loans',
                        'party_loan_repayments', 'audit_log',
                        'bills', 'bill_lines', 'supplier_payments', 'supplier_payment_allocations',
                        'tax_remittances', 'cash_transfers', 'owner_equity_movements',
                        'partners', 'partner_profit_shares')
  LOOP
    EXECUTE format('ALTER TABLE %I %s TRIGGER %I', t.table_name, v_mode, t.tgname);
  END LOOP;
END;
$$;

-- CREATE OR REPLACE keeps the function's ACL, but state the 0010 hardening again
-- so this file cannot be the one that quietly re-opened it.
REVOKE EXECUTE ON FUNCTION financial_guards_set(boolean) FROM PUBLIC;
