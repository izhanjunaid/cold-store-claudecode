-- 0046 — A manager can allow what a munshi asked for (C3, docs/28 O8-O11).
--
-- Expand-only: columns the previous image never reads. `manager_allows` holds the codes a manager allowed
-- (CHEQUE_OR_TRANSFER, CREDIT, LEAVE_CHARGE_OFF — checked by the API, so a later code needs no migration), with who
-- and when; an allowance is live only on the business day it was given. `credit_allowed_by` is stamped at checkout when
-- the solo door billed on a live CREDIT allowance, so the load slip names the manager who let it go on credit.
-- Plain uuids, no foreign keys, as manager_ask_*: the audit trigger on outbound_events records who changed the row.

ALTER TABLE "outbound_events"
  ADD COLUMN "manager_allows" VARCHAR(30)[] NOT NULL DEFAULT ARRAY[]::VARCHAR(30)[],
  ADD COLUMN "manager_allowed_by" UUID,
  ADD COLUMN "manager_allowed_at" TIMESTAMPTZ,
  ADD COLUMN "credit_allowed_by" UUID;
