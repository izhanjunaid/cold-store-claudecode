-- ============================================================
-- Migration 0016: Draft-stage invoice discount (Phase 12)
--
--   * One discount per invoice (PERCENT or FIXED), applied while DRAFT.
--   * discount_amount_pkr is the computed PKR amount persisted alongside
--     the type/value so totals and JE-01 never re-derive it.
--   * New contra-revenue accounts 4900 (header) / 4910 (Discounts
--     Allowed, normal balance DEBIT) backfilled for every facility.
--     Fresh databases get them via prisma/seed.ts.
-- ============================================================

-- 1. Discount type enum
CREATE TYPE "DiscountType" AS ENUM ('PERCENT', 'FIXED');

-- 2. Invoice discount columns
ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "discount_type"       "DiscountType",
  ADD COLUMN IF NOT EXISTS "discount_value"      DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "discount_amount_pkr" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- 3. Contra-revenue accounts for existing facilities (idempotent)
INSERT INTO "chart_of_accounts"
  ("id", "facility_id", "account_code", "account_name", "account_class",
   "account_type", "parent_account_code", "normal_balance", "is_system_account", "is_active")
SELECT gen_random_uuid(), f."id", '4900', 'Contra Revenue', 'REVENUE',
       'HEADER', NULL, 'CREDIT', false, true
FROM "facilities" f
ON CONFLICT ("facility_id", "account_code") DO NOTHING;

INSERT INTO "chart_of_accounts"
  ("id", "facility_id", "account_code", "account_name", "account_class",
   "account_type", "parent_account_code", "normal_balance", "is_system_account", "is_active")
SELECT gen_random_uuid(), f."id", '4910', 'Discounts Allowed', 'REVENUE',
       'DETAIL', '4900', 'DEBIT', false, true
FROM "facilities" f
ON CONFLICT ("facility_id", "account_code") DO NOTHING;
