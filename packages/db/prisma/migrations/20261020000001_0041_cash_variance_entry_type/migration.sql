-- 0041 — A counted-vs-expected cash difference at a handover posts its own entry type
-- (fast-dispatch Phase C1c). Alone in its file: ALTER TYPE … ADD VALUE cannot share a
-- transaction with statements that use the value.
ALTER TYPE "EntryType" ADD VALUE IF NOT EXISTS 'CASH_VARIANCE';
