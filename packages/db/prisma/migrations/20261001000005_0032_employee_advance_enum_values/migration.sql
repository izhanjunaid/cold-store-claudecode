-- 0032 — An employee advance can be voided, and repaid in cash (docs/25 C-26).
--
-- Alone in their file: PostgreSQL refuses to use an enum value in the
-- transaction that adds it, and 0033 and the application use them.
ALTER TYPE "EmployeeAdvanceStatus" ADD VALUE IF NOT EXISTS 'VOIDED';
ALTER TYPE "EntryType" ADD VALUE IF NOT EXISTS 'EMPLOYEE_ADVANCE_REPAYMENT';
