-- 0051 — Rent billed for a period, without a withdrawal (docs/32 section 2.6, Stage 3).
--
-- Expand-only: three defaulted or nullable columns. The previous image ignores them.
--
-- Until now rent was billed only when goods left (or changed owner). A store also bills at
-- the month's end for khata clients, at the season's end, and for goods nobody collects.
--
--   invoices.rent_period_bill   this bill charged rent on the lot's units up to its period_end,
--                               with the goods still in the room.
--   lots.rent_start_date        where the present owner's rent starts, when it is not the latest
--                               change of owner: set when a buyer takes a lot over together with
--                               its unbilled rent.
--   lots.rent_billed_carried_pkr rent per unit already billed on these units under another lot
--                               number (a part of a lot taken over by a buyer).
--
-- What a unit has already been billed is never stored on the lot: it is the sum of the lot's
-- period bills that are not void, so cancelling a bill needs no second correction.

ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "rent_period_bill" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "lots" ADD COLUMN IF NOT EXISTS "rent_start_date" DATE;
ALTER TABLE "lots" ADD COLUMN IF NOT EXISTS "rent_billed_carried_pkr" NUMERIC(12,2) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "invoices_rent_period_bill_idx" ON "invoices" ("lot_id") WHERE "rent_period_bill";
