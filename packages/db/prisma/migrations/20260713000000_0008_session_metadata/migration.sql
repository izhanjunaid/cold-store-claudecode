-- ============================================================================
-- 0008 — Session metadata on refresh tokens (Phase 15)
--
-- Each refresh token already represents one logged-in device/session. Capture
-- the browser (user_agent) and IP behind it, plus last_used_at (bumped on every
-- refresh), so a user can review and revoke their active sessions. Purely
-- additive — existing tokens keep working with NULL metadata.
-- ============================================================================

-- AlterTable
ALTER TABLE "refresh_tokens" ADD COLUMN "user_agent" VARCHAR(400);
ALTER TABLE "refresh_tokens" ADD COLUMN "ip" VARCHAR(45);
ALTER TABLE "refresh_tokens" ADD COLUMN "last_used_at" TIMESTAMPTZ;
