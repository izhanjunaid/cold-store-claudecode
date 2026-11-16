-- 0050 — Units belong to the goods (docs/32 section 2.4, Stage 2).
--
-- Expand-only: four new columns on commodities, defaulted or nullable. The previous image
-- ignores them. The columns named *_bags across the schema keep their names and mean "units".
--
--   unit_name       one unit, in English: "Bag", "Crate". unit_label (existing) stays the plural.
--   unit_name_urdu  the same in Urdu, for papers and Urdu screens.
--   unit_weight_kg  what one unit usually weighs, when the store knows it. Not used for billing.
--   space_factor    how much room one unit takes, measured in the room's capacity units. 1 for the
--                   goods the room's capacity is counted in; a crate that takes half the space
--                   of a bag is 0.5. Room capacity then holds a mix of goods correctly.

ALTER TABLE "commodities" ADD COLUMN IF NOT EXISTS "unit_name" VARCHAR(20);
ALTER TABLE "commodities" ADD COLUMN IF NOT EXISTS "unit_name_urdu" VARCHAR(40);
ALTER TABLE "commodities" ADD COLUMN IF NOT EXISTS "unit_weight_kg" NUMERIC(8,2);
ALTER TABLE "commodities" ADD COLUMN IF NOT EXISTS "space_factor" NUMERIC(6,3) NOT NULL DEFAULT 1;

-- One unit, from the plural already stored ("Bags" -> "Bag", "Crates" -> "Crate", "Boxes" -> "Box").
UPDATE "commodities"
   SET "unit_name" = CASE
         WHEN lower("unit_label") ~ '(x|ch|sh|ss)es$' THEN left("unit_label", length("unit_label") - 2)
         WHEN lower("unit_label") ~ '[^s]s$'          THEN left("unit_label", length("unit_label") - 1)
         ELSE "unit_label"
       END
 WHERE "unit_name" IS NULL;

UPDATE "commodities" SET "unit_name_urdu" = 'بوری' WHERE "unit_name_urdu" IS NULL AND lower("unit_name") = 'bag';
UPDATE "commodities" SET "unit_name_urdu" = 'پیٹی' WHERE "unit_name_urdu" IS NULL AND lower("unit_name") = 'crate';
