-- 0047 — A lot remembers that its season rent is already billed (docs/31 T-2, docs/32 2.6).
--
-- A seasonal fee is flat per bag. At a change of owner the seller is billed it, and the buyer's
-- withdrawal used to bill it a second time. The flag is set at the transfer and read when a
-- withdrawal is priced. Expand-only: defaulted, and the previous image never reads it.

ALTER TABLE "lots" ADD COLUMN "season_fee_billed" BOOLEAN NOT NULL DEFAULT false;

-- Lots already transferred in full on a seasonal plan: the seller holds a bill for the whole
-- season (an invoice with no withdrawal that is not a surcharge), so the buyer owes none.
UPDATE "lots" l
SET "season_fee_billed" = true
FROM "rate_plans" r
WHERE r."id" = l."rate_plan_id"
  AND r."rate_type" = 'SEASONAL_PER_BAG'
  AND l."status" = 'ACTIVE'
  AND EXISTS (
    SELECT 1 FROM "invoices" i
    WHERE i."lot_id" = l."id"
      AND i."outbound_event_id" IS NULL
      AND i."surcharge_of_invoice_id" IS NULL
      AND i."status" <> 'VOID'
  );
