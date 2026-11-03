-- 0044 — A lot's vehicle number takes 30 characters (C3 part 1, docs/28 D5).
--
-- Expand-only: a gate pass and a withdrawal (0038) already take 30; the lot's column held 20, so a
-- plate picked from the trucks inside the gate could be too long for the lot form. Widening a
-- VARCHAR is metadata-only in PostgreSQL, and the previous image never writes more than 20.

ALTER TABLE "lots" ALTER COLUMN "vehicle_number" TYPE VARCHAR(30);
