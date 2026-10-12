-- 0037 — The tariff rule of a TARIFF_PER_BAG rate plan.
--
-- Expand-only: a nullable column the previous release never reads. The monthly rate,
-- the minimum days and the season end stay in their own columns; this holds only the
-- rule's shape. No existing row can be TARIFF_PER_BAG (the value is new in 0036), so
-- the constraint is validated on creation.
ALTER TABLE "rate_plans" ADD COLUMN IF NOT EXISTS "tariff" JSONB;

ALTER TABLE "rate_plans" DROP CONSTRAINT IF EXISTS "rate_plans_tariff_required";
ALTER TABLE "rate_plans" ADD CONSTRAINT "rate_plans_tariff_required"
  CHECK ("rate_type" <> 'TARIFF_PER_BAG' OR "tariff" IS NOT NULL);
