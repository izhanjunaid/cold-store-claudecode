-- ============================================================================
-- 0006 — OTP codes (Phase 15)
--
-- Short-lived email verification codes for self-service password reset and
-- login 2FA. code_hash is the sha256 hex of a 6-digit code; codes are
-- single-use (consumed_at), expire after ~10 minutes, and verification is
-- capped via attempt_count. Purely additive.
-- ============================================================================

-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('PASSWORD_RESET', 'LOGIN_2FA');

-- CreateTable
CREATE TABLE "otp_codes" (
    "id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "purpose" "OtpPurpose" NOT NULL,
    "code_hash" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "consumed_at" TIMESTAMPTZ,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "requested_ip" VARCHAR(45),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "otp_codes_user_id_purpose_idx" ON "otp_codes"("user_id", "purpose");

-- AddForeignKey
ALTER TABLE "otp_codes" ADD CONSTRAINT "otp_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "otp_codes" ADD CONSTRAINT "otp_codes_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row-Level Security: facility isolation, parity with refresh_tokens.
ALTER TABLE otp_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY otp_code_facility_isolation ON otp_codes
  FOR ALL USING (facility_id = current_setting('app.facility_id', true)::uuid);
