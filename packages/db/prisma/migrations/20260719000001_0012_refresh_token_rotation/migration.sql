-- ============================================================================
-- 0012 — Distinguish rotation-revoked refresh tokens (Phase 18)
--
-- Reuse detection must fire ONLY when a token that was superseded by rotation
-- is replayed (that specific replay proves a second party holds it). Tokens
-- revoked for ordinary reasons — logout, "sign out other devices", password
-- change, admin force sign-out — are routinely replayed by stale tabs and
-- must fail with a plain 401 without nuking the user's live sessions.
-- rotated_at is stamped alongside revoked_at only in the rotation path.
-- ============================================================================

ALTER TABLE "refresh_tokens" ADD COLUMN "rotated_at" TIMESTAMPTZ;
