-- ---------------------------------------------------------------------------
-- One posted opening-balance entry per facility, enforced by the database.
--
-- opening-balance.service.ts serialises concurrent entries with
-- advisoryXactLock('<facility>:opening-balances') and its own comment records
-- that the lock is the ONLY guard: @@index([sourceTable, sourceId]) is not
-- unique. That matters more here than almost anywhere else in the schema,
-- because a posted entry is immutable by trigger — two concurrent POSTs that
-- both passed the existence check would double every opening balance
-- permanently, with no way to edit either row back out.
--
-- The advisory lock stays: it produces the good error message and it is what
-- the API tests assert against. This index makes the invariant true even if
-- the lock is ever bypassed, refactored away, or defeated by a caller that
-- opens its own transaction.
--
-- Deliberately scoped to POSTED rows only. The documented recovery path is
-- "reverse the entry and re-enter" (opening_balances is one of only two
-- source tables journal-entry.service.ts reverse() whitelists). Reversal
-- flips the original to REVERSED, which drops it out of this predicate, and
-- the mirror entry it creates carries source_table = 'journal_entries', not
-- 'opening_balances' — so neither row occupies the slot and re-entry works.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS journal_entries_one_opening_balance_per_facility
  ON journal_entries (facility_id)
  WHERE source_table = 'opening_balances' AND posting_status = 'POSTED';
