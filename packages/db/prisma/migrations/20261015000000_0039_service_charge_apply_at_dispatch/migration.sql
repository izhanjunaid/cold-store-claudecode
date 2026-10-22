-- 0039 — A service charge can be marked "apply at dispatch".
--
-- The dispatch-and-collect checkout finalizes the invoice in the same step it
-- dispatches, and a finalized invoice can only be corrected downward (credit note)
-- — an under-billing, like a forgotten loading charge, cannot be fixed. So the
-- charges that belong on every dispatch (loading, labour) are pre-added to the bill,
-- and leaving one off becomes a deliberate act.
--
-- Expand-only: a defaulted column the previous release never reads.
ALTER TABLE "service_charges" ADD COLUMN IF NOT EXISTS "apply_at_dispatch" BOOLEAN NOT NULL DEFAULT false;