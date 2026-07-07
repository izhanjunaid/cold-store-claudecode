-- ============================================================================
-- 0003 — Allocation soft-void + posting-template account protection
--
-- F-11: cheque dishonour previously hard-deleted payment_allocations and
-- party_loan_repayments (the GL was reversed correctly, but the operational
-- story of what was unwound vanished). Rows are now kept and voided.
--
-- F-10: only 5 of ~84 seeded accounts were system-protected while the JE
-- templates and financial statements hard-wire ~55 of them. Deactivating any
-- of these (one PATCH) bricks the posting flows that reference them. Flag
-- every template- or statement-wired account as a system account so the
-- existing SYSTEM_ACCOUNT_PROTECTED guard covers them.
-- ============================================================================

ALTER TABLE payment_allocations
  ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS voided_by UUID;

ALTER TABLE party_loan_repayments
  ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS voided_by UUID;

UPDATE chart_of_accounts SET is_system_account = true
WHERE account_code IN (
  -- statement headers
  '1000','1100','1200','1300','2000','2100','4000','4100','4200','4900','5000','6000','6100',
  -- template-wired detail accounts
  '1010','1020','1030','1110','1120','1130','1140','1150',
  '1310','1311','1320','1321','1330','1331','1340','1341',
  '2010','2020','2030','2040','2060','2061','2070',
  '3030',
  '4010','4020','4030','4040','4050','4150','4230','4910',
  '5030','5035','5040',
  '6010','6015','6080','6110','6120','6130','6140'
);
