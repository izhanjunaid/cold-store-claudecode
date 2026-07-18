-- ============================================================================
-- 0011 — TOTP authenticator-app 2FA (Phase 18)
--
-- users gains an encrypted TOTP secret (aes-256-gcm via APP_ENCRYPTION_KEY,
-- never plaintext — settings/audit snapshots must stay secret-free) and an
-- enabled timestamp (secret present + enabled_at NULL = enrollment pending).
-- user_backup_codes holds one-time recovery codes: code_hash is the sha256
-- hex of an XXXX-XXXX code, single-use via used_at. Purely additive.
--
-- NOTE ON NUMBERING: 0010 (revoke_financial_guards_from_public) ships on the
-- phase/17 branch; this migration is deliberately numbered 0011 with a later
-- timestamp so both histories interleave cleanly at merge time.
-- ============================================================================

-- AlterTable
ALTER TABLE "users" ADD COLUMN "totp_secret_enc" VARCHAR(500),
                    ADD COLUMN "totp_enabled_at" TIMESTAMPTZ;

-- CreateTable
CREATE TABLE "user_backup_codes" (
    "id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code_hash" VARCHAR(64) NOT NULL,
    "used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_backup_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_backup_codes_user_id_idx" ON "user_backup_codes"("user_id");

-- AddForeignKey
ALTER TABLE "user_backup_codes" ADD CONSTRAINT "user_backup_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_backup_codes" ADD CONSTRAINT "user_backup_codes_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row-Level Security: facility isolation, parity with otp_codes/refresh_tokens.
ALTER TABLE user_backup_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_backup_code_facility_isolation ON user_backup_codes
  FOR ALL USING (facility_id = current_setting('app.facility_id', true)::uuid);
