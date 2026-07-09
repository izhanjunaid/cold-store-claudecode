-- 0004: Opening balances (audit Gap 1) plug to 3010 Owner's Capital, so the
-- account is now flow-wired and must be protected like the other system
-- accounts (no deactivation, no structural edits).
UPDATE chart_of_accounts SET is_system_account = true WHERE account_code = '3010';
