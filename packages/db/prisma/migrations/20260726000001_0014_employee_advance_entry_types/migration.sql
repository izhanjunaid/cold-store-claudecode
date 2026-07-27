-- ============================================================================
-- 0014 — EntryType values for employee-advance issue/write-off (Phase 21)
--
-- Issue and write-off each post their own journal entry (JE-22, JE-23) and need
-- a distinct entryType, same as peshgi's PESHGI_ISSUE/PESHGI_WRITE_OFF. Recovery
-- deliberately gets none: it rides inside the payroll entry (JE-15/JE-15B) as an
-- extra credit line to 1230, so it is tagged PAYROLL like the rest of that entry.
--
-- Split into its own migration, after 0013's tables, because PostgreSQL forbids
-- using a new enum value in the same transaction that adds it — Prisma applies
-- each migration file as one transaction, so the value must exist before any
-- code in a later migration or application release can reference it.
-- ============================================================================

ALTER TYPE "EntryType" ADD VALUE 'EMPLOYEE_ADVANCE_ISSUE';
ALTER TYPE "EntryType" ADD VALUE 'EMPLOYEE_ADVANCE_WRITE_OFF';
