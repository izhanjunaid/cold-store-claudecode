-- ---------------------------------------------------------------------------
-- Where an account's cash movements land on the statement of cash flows.
--
-- Follows the statement_section pattern from migration 0015 exactly, for the
-- same reason: presentation must be data, not a hardcoded list in the report.
-- Like statement_section, this column is outside guard_chart_of_accounts's
-- watched set (account_code, class, type, parent, normal_balance), so it stays
-- editable on an account that already carries postings.
--
-- Nullable, and null is the normal state. The section is DERIVED from
-- statement_section + account_class for the overwhelming majority of accounts
-- (operating for working capital and P&L accounts, investing for non-current
-- assets, financing for non-current liabilities and equity). This column only
-- exists to override the handful where that derivation is wrong.
--
-- Two are seeded here because they are wrong by default and would otherwise
-- quietly misclassify real cash:
--   1140 Receivable — Peshgi: a current asset, so it derives to OPERATING,
--         which is also where it belongs — peshgi are trade-linked advances to
--         farmers, not investments. Pinned so a future reclassification of the
--         account cannot silently move it to investing.
--   2120 Loan from Director / Owner: derives to FINANCING from
--         NON_CURRENT_LIABILITY, which is correct. Pinned for the same reason.
-- ---------------------------------------------------------------------------
CREATE TYPE "CashFlowSection" AS ENUM ('OPERATING', 'INVESTING', 'FINANCING');

ALTER TABLE "chart_of_accounts" ADD COLUMN "cash_flow_section" "CashFlowSection";
