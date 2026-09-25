-- 0031 — Two journal-entry invariants the new reversal path relies on (docs/25).

-- ---------------------------------------------------------------------------
-- 1. A posted journal entry always has a number (docs/25 L-13).
--
-- 0029 made entry_number nullable so a DRAFT takes its number only when it is
-- posted. That is only safe if the other half is enforced: a POSTED entry with no
-- number would be unreferenceable on every statement and in the audit trail.
-- NOT VALID + conditional VALIDATE, same fail-safe pattern as 0030.
-- ---------------------------------------------------------------------------
ALTER TABLE "journal_entries"
  ADD CONSTRAINT "journal_entries_posted_has_number"
  CHECK ("posting_status" <> 'POSTED' OR "entry_number" IS NOT NULL) NOT VALID;

DO $$
BEGIN
  ALTER TABLE "journal_entries" VALIDATE CONSTRAINT "journal_entries_posted_has_number";
EXCEPTION WHEN check_violation THEN
  RAISE WARNING 'journal_entries_posted_has_number: existing rows violate it; left NOT VALID (new rows are still checked).';
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. One standing opening-balance entry per facility — excluding its reversal.
--
-- A reversal now inherits the source of the entry it reverses (docs/25 §2
-- invariant 3), so reversing the opening balances produces a second
-- 'opening_balances' entry: the mirror. It is POSTED and nothing reverses it, so
-- under 0025's predicate it would occupy the one slot and re-entering opening
-- balances — the documented recovery path — would fail. The standing entry is
-- the one that is neither reversed nor itself a reversal.
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS journal_entries_one_opening_balance_per_facility;

CREATE UNIQUE INDEX journal_entries_one_opening_balance_per_facility
  ON journal_entries (facility_id)
  WHERE source_table = 'opening_balances'
    AND posting_status = 'POSTED'
    AND reversed_by IS NULL
    AND entry_type <> 'REVERSAL';
