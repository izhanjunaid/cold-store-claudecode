-- 0052 — A rate agreed with one client (docs/32 section 2.5, Stage 3).
--
-- Expand-only: one nullable column. A rate plan that names a party is that client's own rate
-- (for the plan's goods, or for all goods). The arrival screen picks it for his lots; nobody
-- else's lots may use it. A plan with no party is the store's ordinary rate, as before.

ALTER TABLE "rate_plans" ADD COLUMN IF NOT EXISTS "party_id" UUID REFERENCES "parties"("id");
CREATE INDEX IF NOT EXISTS "rate_plans_party_idx" ON "rate_plans" ("party_id") WHERE "party_id" IS NOT NULL;
