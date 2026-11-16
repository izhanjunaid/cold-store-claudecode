-- 0048 — Text-search indexes for the lot search box (docs/31 F-2, measured in docs/31 section 4).
--
-- The search matches any part of a lot number, marka or vehicle number, which no ordinary index
-- serves, so every search read every lot (about 0.3 s at 30,000 lots, growing with the store).
-- Trigram indexes serve it in a few milliseconds.
--
-- pg_trgm ships with PostgreSQL and is a trusted extension, so the database owner can create it.
-- If this role may not, the indexes are skipped: the search still works, only slower. Expand-only.

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  CREATE INDEX IF NOT EXISTS "lots_lot_number_trgm_idx" ON "lots" USING gin ("lot_number" gin_trgm_ops);
  CREATE INDEX IF NOT EXISTS "lots_marka_trgm_idx" ON "lots" USING gin ("marka" gin_trgm_ops);
  CREATE INDEX IF NOT EXISTS "lots_vehicle_number_trgm_idx" ON "lots" USING gin ("vehicle_number" gin_trgm_ops);
EXCEPTION WHEN insufficient_privilege OR undefined_file OR feature_not_supported THEN
  RAISE NOTICE 'pg_trgm is not available (%); lot search stays unindexed', SQLERRM;
END $$;
