-- Every reversal in the ledger was applied twice.
--
-- markReversed() set the original entry's posting_status to REVERSED **and**
-- the caller separately posted a full mirror entry. Every statement, the GL
-- and the trial balance filter posting_status = 'POSTED', so the original
-- dropped out of the ledger entirely *and* the mirror was applied.
--
-- Measured on a 10,000 cheque receipt, dishonoured, with no withholding:
--   AR control (1110-1150):  0 -> -10,000 -> +10,000   (should end at 0)
--   1025 Cheques in Hand:    0 -> +10,000 -> -10,000   (should end at 0)
-- Equal and opposite, so the trial balance still balanced. That symmetry is
-- why three accounting audits did not see it.
--
-- The fix keeps the original POSTED and lets the mirror do the reversing. That
-- is also the correct treatment on its own terms: the original really happened
-- and belongs in its own period, while the mirror is dated when the reversal
-- happened. Marking the original REVERSED erased it retroactively from the
-- period it belonged to -- a bounce in April silently restated March.
--
-- All six call sites post a FULL mirror (lines swapped 1:1) whose amount
-- equals the original(s) it marks -- verified individually before this ran:
-- JournalEntryService.reverse, invoice VOID, fixed-asset reverseDisposal,
-- payroll run reversal, and the two payment-dishonour paths.

-- ---------------------------------------------------------------------------
-- 1. Allow the new transition: POSTED -> POSTED, setting reversed_by once,
--    with nothing else changing.
--
--    The legacy POSTED -> REVERSED branch is KEPT deliberately. Deploy files
--    and the api image are a matched pair, but a rolled-back image still calls
--    markReversed with REVERSED; failing hard there would take the store
--    offline, and the trigger's job is the immutability of financial content,
--    not which flag the application uses to record a reversal.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION guard_journal_entries_fn()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.posting_status = 'AUTO_DRAFT' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'journal entry % cannot be deleted once posted (post a reversal entry instead)', OLD.entry_number;
  END IF;

  IF OLD.posting_status = 'AUTO_DRAFT' THEN
    RETURN NEW;
  END IF;

  -- Current path: the original stays POSTED and only records which entry
  -- reversed it. Once set, reversed_by may not be changed again.
  IF OLD.posting_status = 'POSTED'
     AND NEW.posting_status = 'POSTED'
     AND OLD.reversed_by IS NULL
     AND NEW.reversed_by IS NOT NULL
     AND (to_jsonb(OLD) - 'reversed_by') = (to_jsonb(NEW) - 'reversed_by') THEN
    RETURN NEW;
  END IF;

  -- Legacy path, retained for rollback safety (see note above).
  IF OLD.posting_status = 'POSTED'
     AND NEW.posting_status = 'REVERSED'
     AND NEW.reversed_by IS NOT NULL
     AND (to_jsonb(OLD) - 'posting_status' - 'reversed_by') = (to_jsonb(NEW) - 'posting_status' - 'reversed_by') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'journal entry % is immutable once posted (corrections require a reversal entry)', OLD.entry_number;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Repair the history.
--
-- Every entry already marked REVERSED has a mirror -- reversed_by points at
-- it, and the trigger required it to be non-null. Putting the original back to
-- POSTED makes each pair net to zero, which is what should have happened all
-- along. Scoped to rows that actually carry a reversed_by so nothing without a
-- mirror is resurrected.
--
-- The trigger has to come off for this: REVERSED -> POSTED is not, and should
-- not become, a legal application transition.
-- ---------------------------------------------------------------------------
ALTER TABLE "journal_entries" DISABLE TRIGGER "guard_journal_entries";

UPDATE "journal_entries"
   SET "posting_status" = 'POSTED'
 WHERE "posting_status" = 'REVERSED'
   AND "reversed_by" IS NOT NULL;

ALTER TABLE "journal_entries" ENABLE TRIGGER "guard_journal_entries";

-- ---------------------------------------------------------------------------
-- 3. Re-cut the one-opening-balance-per-facility index.
--
-- Migration 0019 keyed it on posting_status = 'POSTED', which worked only
-- because a reversed entry stopped being POSTED. Now that the original stays
-- POSTED, a reversed opening-balance entry would keep occupying the slot and
-- re-entering opening balances after a reversal would fail -- the exact
-- rollback path docs/23 depends on. "Still standing" is reversed_by IS NULL.
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS journal_entries_one_opening_balance_per_facility;

CREATE UNIQUE INDEX journal_entries_one_opening_balance_per_facility
  ON journal_entries (facility_id)
  WHERE source_table = 'opening_balances'
    AND posting_status = 'POSTED'
    AND reversed_by IS NULL;
