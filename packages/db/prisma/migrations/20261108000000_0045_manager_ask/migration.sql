-- 0045 — A munshi can call a manager on a withdrawal (C3 part 3, docs/28 O6).
--
-- Expand-only: two nullable columns the previous image never reads. A call stamps what the buyer
-- wants (CALLED, CHEQUE_OR_TRANSFER, CREDIT, LEAVE_CHARGE_OFF — checked by the API, so a later code
-- needs no migration) and when; the managers' waiting list shows called withdrawals first. The
-- audit trigger on outbound_events records who called.

ALTER TABLE "outbound_events"
  ADD COLUMN "manager_ask_code" VARCHAR(30),
  ADD COLUMN "manager_ask_at" TIMESTAMPTZ;
