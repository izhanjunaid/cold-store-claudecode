-- Seeding the overrides is a separate migration because PostgreSQL forbids
-- using a new enum value in the same transaction that created the type
-- (migrations 0014 and 0016 exist for exactly this rule).
--
-- No facility_id filter, matching the precedent set by 0004 and 0015 for
-- seeded-account backfills.
UPDATE chart_of_accounts SET cash_flow_section = 'OPERATING' WHERE account_code = '1140';
UPDATE chart_of_accounts SET cash_flow_section = 'FINANCING' WHERE account_code = '2120';
