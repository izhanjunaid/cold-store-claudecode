-- ============================================================
-- Migration 0012: User must_change_password flag
--
-- Phase 11.4 — S-39 User Management. When OWNER creates a new
-- user or resets an existing user's password, this flag is set
-- so the web layer can force the user through /change-password
-- on next login. Existing users default to false (no disruption).
-- ============================================================

ALTER TABLE "users"
  ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT false;
