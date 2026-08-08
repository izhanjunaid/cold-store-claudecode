-- ============================================================================
-- 0015 — statement_section on chart_of_accounts (phase/24)
--
-- financial-statements.service.ts placed accounts into P&L/balance-sheet
-- sections via nine hardcoded header-code arrays (['1000','1100','1200'],
-- ['4000','4100'], ...). The API already accepted HEADER accounts with no
-- restriction — three tests proved it end to end — but a header outside
-- those nine codes got no section: its children fell into the statements'
-- "unclassified" bucket (F-6b), and until phase/24's P&L fix, that bucket
-- reached net_profit_pkr only, leaving operating_profit_pkr and ebitda_pkr
-- silently wrong. Only the web UI's hardcoded `account_type: 'DETAIL'`
-- literal kept an owner from ever hitting this.
--
-- This column makes the section a property of the account instead of a
-- literal in the service. Nullable and additive:
--   - existing accounts backfilled below (the 12 seeded headers map 1:1 onto
--     the nine arrays being replaced)
--   - a HEADER created with no section still routes its children to
--     unclassified — F-6b is unchanged, not removed
--   - EQUITY headers take no section deliberately: equity aggregates by
--     class, not by header (phase/19), and 3010/3020/3030 sit at the root
--   - guard_chart_of_accounts (migration 0002) is BEFORE UPDATE and only
--     fires on account_code/account_class/account_type/parent_account_code/
--     normal_balance — this column is outside that set, so a header's
--     section stays editable even once it has DETAIL children with postings,
--     exactly like is_active and account_name already are
-- ============================================================================

-- CreateEnum
CREATE TYPE "StatementSection" AS ENUM ('CURRENT_ASSET', 'NON_CURRENT_ASSET', 'CURRENT_LIABILITY', 'NON_CURRENT_LIABILITY', 'REVENUE', 'CONTRA_REVENUE', 'OTHER_INCOME', 'COST_OF_SERVICE', 'OPERATING_EXPENSE');

-- AlterTable
ALTER TABLE "chart_of_accounts" ADD COLUMN "statement_section" "StatementSection";

-- Backfill: the 12 seeded headers, across every facility (no facility_id
-- filter, matching migration 0004's precedent for a seed-account backfill).
UPDATE chart_of_accounts SET statement_section = 'CURRENT_ASSET'      WHERE account_code IN ('1000', '1100', '1200');
UPDATE chart_of_accounts SET statement_section = 'NON_CURRENT_ASSET'  WHERE account_code = '1300';
UPDATE chart_of_accounts SET statement_section = 'CURRENT_LIABILITY'  WHERE account_code = '2000';
UPDATE chart_of_accounts SET statement_section = 'NON_CURRENT_LIABILITY' WHERE account_code = '2100';
UPDATE chart_of_accounts SET statement_section = 'REVENUE'            WHERE account_code IN ('4000', '4100');
UPDATE chart_of_accounts SET statement_section = 'CONTRA_REVENUE'     WHERE account_code = '4900';
UPDATE chart_of_accounts SET statement_section = 'OTHER_INCOME'       WHERE account_code = '4200';
UPDATE chart_of_accounts SET statement_section = 'COST_OF_SERVICE'    WHERE account_code = '5000';
UPDATE chart_of_accounts SET statement_section = 'OPERATING_EXPENSE'  WHERE account_code = '6000';
