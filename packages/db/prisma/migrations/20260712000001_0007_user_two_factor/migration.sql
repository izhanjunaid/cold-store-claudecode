-- ============================================================================
-- 0007 — Per-user email 2FA flag (Phase 15)
-- ============================================================================

-- AlterTable
ALTER TABLE "users" ADD COLUMN "two_factor_enabled" BOOLEAN NOT NULL DEFAULT false;
