-- ============================================================================
-- 0011 — Unique invoice number per facility (Phase 20, audit P2-0a)
--
-- Every other document number in the schema is backed by a unique constraint
-- (journal entries, credit notes, expense vouchers, loans, payroll runs, fixed
-- assets, gate passes, dispatch notes, lots). `invoices.invoice_number` had only
-- a plain index, so the advisory lock in generateInvoiceNumber() was its sole
-- protection.
--
-- That protection did not exist. The lock was taken with
--     SELECT 1 AS _lock WHERE pg_advisory_xact_lock(...) IS NOT NULL OR TRUE
-- which PostgreSQL folds away without evaluating (fixed in the same phase — see
-- apps/api/src/common/advisory-lock.ts). Invoice numbering therefore had no
-- concurrency protection of any kind: two invoices finalized in the same month
-- at the same moment could take the same number, and an invoice number is what a
-- customer quotes in a dispute.
--
-- BEFORE APPLYING to an existing database, confirm there are no duplicates:
--
--     SELECT facility_id, invoice_number, count(*)
--     FROM invoices
--     WHERE invoice_number IS NOT NULL
--     GROUP BY 1, 2 HAVING count(*) > 1;
--
-- If that returns rows this migration will fail on apply, which is the intended
-- behaviour: duplicate historical invoice numbers are a data-repair decision
-- (which document gets renumbered), not something a migration should guess at.
--
-- NULL is permitted and repeats freely — DRAFT invoices carry no number until
-- finalize, and PostgreSQL treats NULLs as distinct in a unique index.
-- ============================================================================

-- DropIndex
DROP INDEX IF EXISTS "invoices_facility_id_invoice_number_idx";

-- CreateIndex
CREATE UNIQUE INDEX "invoices_facility_id_invoice_number_key" ON "invoices"("facility_id", "invoice_number");
