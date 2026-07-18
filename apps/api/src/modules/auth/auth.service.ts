import type { PrismaClient } from '@coldchain/db';
import { validateNewPassword } from '@coldchain/shared';
import { AuthRepository } from './auth.repository';
import { OtpService, OTP_TTL_MINUTES } from './otp.service';
import { MailService, mailConfigFromSettings, type MailConfig } from '../mail/mail.service';
import {
  signAccessToken,
  signRefreshToken,
  signPendingTwoFactorToken,
  verifyPendingTwoFactorToken,
} from '../../common/jwt';
import { Errors } from '../../common/errors';
import { hashPassword, verifyPassword, needsRehash } from '../../common/password';
import { passwordMinLength } from '../../common/env';
import { encryptSecret, decryptSecret } from '../../common/crypto';
import {
  TotpService,
  generateTotpSecret,
  buildOtpauthUri,
  verifyTotpToken,
  looksLikeBackupCode,
} from './totp.service';

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes

interface TokenUser {
  id: string;
  facilityId: string;
  email: string;
  name: string;
  role: string;
  mustChangePassword: boolean;
}

// Device/browser context captured on each session (refresh-token row).
export interface SessionMeta {
  userAgent?: string | null;
  ip?: string | null;
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return email;
  return `${local[0]}***@${domain}`;
}

export class AuthService {
  private readonly totp: TotpService;

  constructor(
    private readonly repo: AuthRepository,
    private readonly prisma: PrismaClient,
    private readonly otp: OtpService,
    private readonly mail: MailService,
  ) {
    this.totp = new TotpService(prisma);
  }

  /** TOTP is fully enrolled (secret stored AND confirmed with a working code). */
  private static totpActive(user: { totpSecretEnc: string | null; totpEnabledAt: Date | null }): boolean {
    return Boolean(user.totpSecretEnc && user.totpEnabledAt);
  }

  async login(facilityId: string, email: string, password: string, meta?: SessionMeta) {
    const user = await this.repo.findUserByEmail(facilityId, email);
    if (!user || !user.isActive) {
      throw Errors.AUTH_INVALID('Invalid email or password');
    }

    // Check lockout
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw Errors.ACCOUNT_LOCKED();
    }

    // Verify password
    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      const shouldLock = user.failedLoginCount + 1 >= MAX_FAILED_ATTEMPTS;
      await this.repo.incrementFailedLogins(
        user.id,
        shouldLock ? new Date(Date.now() + LOCK_DURATION_MS) : undefined,
      );
      throw Errors.AUTH_INVALID('Invalid email or password');
    }

    // Transparent upgrade: a successful login with a legacy bcrypt hash gets
    // re-hashed with argon2id, migrating the user base without forcing resets.
    if (needsRehash(user.passwordHash)) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(password) },
      });
    }

    // Password verified. TOTP (authenticator app) is checked first and has NO
    // bypass: verification is clock-based and fully offline, so "email is
    // down" can never downgrade a TOTP account to password-only.
    if (AuthService.totpActive(user)) {
      return {
        requires_2fa: true as const,
        method: 'totp' as const,
        pending_token: signPendingTwoFactorToken({ userId: user.id, facilityId: user.facilityId }),
        message: 'Enter the code from your authenticator app, or a backup code.',
      };
    }

    // Email 2FA (legacy): park the login behind an emailed code; if email is
    // unconfigured/unreachable (offline box), proceed but flag the bypass so
    // the UI can warn.
    if (user.twoFactorEnabled) {
      const config = await this.resolveMailConfig(facilityId);
      if (config) {
        const sent = await this.sendLoginCode(user, facilityId, config.config, config.facilityName);
        if (sent) {
          return {
            requires_2fa: true as const,
            method: 'email' as const,
            pending_token: signPendingTwoFactorToken({ userId: user.id, facilityId: user.facilityId }),
            message: `A verification code was sent to ${maskEmail(user.email)}.`,
          };
        }
      }
      await this.repo.updateLastLogin(user.id);
      return { ...(await this.issueTokens(user, meta)), two_factor_bypassed: true };
    }

    // Success — reset failed count, update last login
    await this.repo.updateLastLogin(user.id);
    return this.issueTokens(user, meta);
  }

  /** Completes a 2FA login: pending token + authenticator/email/backup code → real tokens. */
  async verify2fa(pendingToken: string, code: string, meta?: SessionMeta) {
    let payload: { userId: string; facilityId: string };
    try {
      payload = verifyPendingTwoFactorToken(pendingToken);
    } catch {
      throw Errors.AUTH_INVALID('Invalid or expired login session — sign in again');
    }

    const user = await this.repo.findUserById(payload.userId);
    if (!user || !user.isActive) throw Errors.AUTH_INVALID('Invalid or expired code');

    let ok = false;
    if (AuthService.totpActive(user)) {
      const trimmed = code.trim();
      let secret: string | null = null;
      try {
        secret = decryptSecret(user.totpSecretEnc!);
      } catch {
        // Encryption key changed since enrollment — authenticator codes cannot
        // be checked, but backup codes (plain sha256) still can.
      }
      if (secret && /^\d{6}$/.test(trimmed)) {
        ok = await verifyTotpToken(trimmed, secret);
      }
      if (!ok && looksLikeBackupCode(trimmed)) {
        ok = await this.totp.consumeBackupCode(user.id, trimmed);
      }
    } else {
      ok = await this.otp.verifyAndConsume(user.id, 'LOGIN_2FA', code);
    }
    if (!ok) throw Errors.AUTH_INVALID('Invalid or expired code');

    await this.repo.updateLastLogin(user.id);
    return this.issueTokens(user, meta);
  }

  /** 2FA enrollment, step 1: email a code to the user's own address. */
  async request2faEnable(userId: string) {
    const user = await this.repo.findUserById(userId);
    if (!user || !user.isActive) throw Errors.AUTH_INVALID('User not found');

    const config = await this.resolveMailConfig(user.facilityId);
    if (!config) {
      throw Errors.VALIDATION_ERROR('Email sending must be configured (Settings → Email) before enabling 2FA');
    }
    const sent = await this.sendLoginCode(user, user.facilityId, config.config, config.facilityName);
    if (!sent) {
      throw Errors.VALIDATION_ERROR('Could not send the verification email — check the email settings');
    }
    return { message: `A verification code was sent to ${maskEmail(user.email)}.` };
  }

  /** 2FA enrollment, step 2: prove the email works, then switch it on. */
  async enable2fa(userId: string, code: string) {
    const user = await this.repo.findUserById(userId);
    if (!user || !user.isActive) throw Errors.AUTH_INVALID('User not found');

    const ok = await this.otp.verifyAndConsume(user.id, 'LOGIN_2FA', code);
    if (!ok) throw Errors.AUTH_INVALID('Invalid or expired code');

    await this.prisma.user.update({ where: { id: userId }, data: { twoFactorEnabled: true } });
    return { two_factor_enabled: true };
  }

  async disable2fa(userId: string, password: string) {
    const user = await this.repo.findUserById(userId);
    if (!user || !user.isActive) throw Errors.AUTH_INVALID('User not found');

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) throw Errors.USER_WRONG_PASSWORD();

    await this.prisma.user.update({ where: { id: userId }, data: { twoFactorEnabled: false } });
    return { two_factor_enabled: false };
  }

  /**
   * TOTP enrollment, step 1: mint a secret and hand back the otpauth URI for
   * the QR code. Stored encrypted immediately, but 2FA stays OFF until a
   * working code proves the authenticator was actually set up (enableTotp).
   * Re-running overwrites any previous pending secret.
   */
  async setupTotp(userId: string) {
    const user = await this.repo.findUserById(userId);
    if (!user || !user.isActive) throw Errors.AUTH_INVALID('User not found');

    const facility = await this.prisma.facility.findUnique({ where: { id: user.facilityId } });
    const issuer = facility?.name || 'ColdChain';

    const secret = generateTotpSecret();
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecretEnc: encryptSecret(secret), totpEnabledAt: null },
    });
    return { otpauth_uri: buildOtpauthUri(user.email, issuer, secret), secret };
  }

  /** TOTP enrollment, step 2: verify a live code, switch 2FA on, mint backup codes. */
  async enableTotp(userId: string, code: string) {
    const user = await this.repo.findUserById(userId);
    if (!user || !user.isActive) throw Errors.AUTH_INVALID('User not found');
    if (!user.totpSecretEnc) {
      throw Errors.VALIDATION_ERROR('Set up the authenticator first (scan the QR code)');
    }

    let secret: string;
    try {
      secret = decryptSecret(user.totpSecretEnc);
    } catch {
      throw Errors.VALIDATION_ERROR('Stored authenticator secret is unreadable — set up again');
    }
    const ok = await verifyTotpToken(code.trim(), secret);
    if (!ok) throw Errors.AUTH_INVALID('Invalid or expired code');

    await this.prisma.user.update({
      where: { id: userId },
      data: { totpEnabledAt: new Date(), twoFactorEnabled: true },
    });
    const backupCodes = await this.totp.mintBackupCodes(userId, user.facilityId);
    return {
      two_factor_enabled: true as const,
      two_factor_method: 'totp' as const,
      backup_codes: backupCodes,
    };
  }

  /** Switch TOTP (and 2FA entirely) off. Requires the account password. */
  async disableTotp(userId: string, password: string) {
    const user = await this.repo.findUserById(userId);
    if (!user || !user.isActive) throw Errors.AUTH_INVALID('User not found');

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) throw Errors.USER_WRONG_PASSWORD();

    await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecretEnc: null, totpEnabledAt: null, twoFactorEnabled: false },
    });
    await this.totp.deleteBackupCodes(userId);
    return { two_factor_enabled: false };
  }

  /** Replace all backup codes with a fresh set (e.g. after using several). */
  async regenerateBackupCodes(userId: string, password: string) {
    const user = await this.repo.findUserById(userId);
    if (!user || !user.isActive) throw Errors.AUTH_INVALID('User not found');
    if (!AuthService.totpActive(user)) {
      throw Errors.VALIDATION_ERROR('Backup codes require authenticator-app 2FA to be enabled');
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) throw Errors.USER_WRONG_PASSWORD();

    const backupCodes = await this.totp.mintBackupCodes(userId, user.facilityId);
    return { backup_codes: backupCodes };
  }

  private async resolveMailConfig(
    facilityId: string,
  ): Promise<{ config: MailConfig; facilityName: string } | null> {
    const facility = await this.prisma.facility.findUnique({ where: { id: facilityId } });
    if (!facility) return null;
    const config = mailConfigFromSettings(facility.settings);
    return config ? { config, facilityName: facility.name } : null;
  }

  private async sendLoginCode(
    user: { id: string; email: string },
    facilityId: string,
    config: MailConfig,
    facilityName: string,
  ): Promise<boolean> {
    const code = await this.otp.issue(user.id, facilityId, 'LOGIN_2FA');
    try {
      await this.mail.send(config, {
        to: user.email,
        subject: 'Your ColdChain login code',
        template: 'otp-code',
        context: {
          facilityName,
          purposeLabel: 'Login verification code',
          code,
          expiresMinutes: OTP_TTL_MINUTES,
        },
      });
      return true;
    } catch {
      return false;
    }
  }

  private async issueTokens(user: TokenUser, meta?: SessionMeta) {
    const rawRefreshToken = AuthRepository.generateToken();
    const refreshTokenRecord = await this.repo.createRefreshToken(
      user.id,
      user.facilityId,
      rawRefreshToken,
      meta,
    );

    const accessToken = signAccessToken({
      userId: user.id,
      facilityId: user.facilityId,
      role: user.role,
      sid: refreshTokenRecord.id,
    });

    const refreshToken = signRefreshToken({
      userId: user.id,
      tokenId: refreshTokenRecord.id,
    });

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        facility_id: user.facilityId,
        must_change_password: user.mustChangePassword,
      },
    };
  }

  async refresh(refreshTokenJwt: string, meta?: SessionMeta) {
    // For simplicity, we use the JWT refresh token approach
    // The refresh token contains userId + tokenId
    const { verifyRefreshToken } = await import('../../common/jwt');
    let payload: { userId: string; tokenId: string };
    try {
      payload = verifyRefreshToken(refreshTokenJwt);
    } catch {
      throw Errors.AUTH_INVALID('Invalid refresh token');
    }

    // The JWT alone is not enough: the stored token row must still be live.
    // Logout, password reset, admin reset and session revocation all revoke
    // rows — a revoked or expired row means this refresh token is dead.
    const tokenRow = await this.repo.findRefreshTokenById(payload.tokenId);
    if (!tokenRow || tokenRow.revokedAt || tokenRow.expiresAt <= new Date()) {
      throw Errors.AUTH_INVALID('Refresh token revoked or expired');
    }

    const user = await this.repo.findUserById(payload.userId);
    if (!user || !user.isActive) {
      throw Errors.AUTH_INVALID('User not found or inactive');
    }

    // Rotate the refresh token but keep this as the same logical session:
    // carry the device metadata forward from the old row (falling back to the
    // current request), and revoke the old row.
    const rawRefreshToken = AuthRepository.generateToken();
    const newTokenRecord = await this.repo.createRefreshToken(
      user.id,
      user.facilityId,
      rawRefreshToken,
      { userAgent: meta?.userAgent ?? tokenRow.userAgent, ip: meta?.ip ?? tokenRow.ip },
    );

    // Revoke old refresh token
    await this.repo.revokeRefreshToken(payload.tokenId).catch(() => {
      // Token may already be revoked
    });

    const accessToken = signAccessToken({
      userId: user.id,
      facilityId: user.facilityId,
      role: user.role,
      sid: newTokenRecord.id,
    });

    const newRefreshToken = signRefreshToken({
      userId: user.id,
      tokenId: newTokenRecord.id,
    });

    return {
      access_token: accessToken,
      refresh_token: newRefreshToken,
    };
  }

  // --- Sessions (Phase 15.6) -------------------------------------------------

  private formatSession(
    s: { id: string; userAgent: string | null; ip: string | null; createdAt: Date; lastUsedAt: Date | null },
    currentSid?: string,
  ) {
    return {
      id: s.id,
      user_agent: s.userAgent,
      ip: s.ip,
      created_at: s.createdAt.toISOString(),
      last_used_at: s.lastUsedAt ? s.lastUsedAt.toISOString() : null,
      current: currentSid != null && s.id === currentSid,
    };
  }

  /** The caller's own active sessions, with the current one flagged. */
  async listSessions(userId: string, currentSid?: string) {
    const sessions = await this.repo.listActiveSessions(userId);
    return { sessions: sessions.map((s) => this.formatSession(s, currentSid)) };
  }

  /** Revoke one of the caller's own sessions (idempotent if already gone). */
  async revokeSession(userId: string, sessionId: string) {
    await this.repo.revokeUserToken(userId, sessionId);
    return { message: 'Session signed out.' };
  }

  /** Sign out every other device, keeping the caller's current session. */
  async revokeOtherSessions(userId: string, currentSid?: string) {
    if (!currentSid) {
      // No current session id on the token (legacy) — nothing safe to keep, so
      // this becomes a full sign-out of the account's sessions.
      await this.repo.revokeAllUserTokens(userId);
      return { message: 'Signed out of all sessions.' };
    }
    await this.repo.revokeOtherUserTokens(userId, currentSid);
    return { message: 'Signed out of all other devices.' };
  }

  /** Admin: another user's active sessions (no "current" — not the admin's). */
  async listUserSessions(userId: string) {
    const sessions = await this.repo.listActiveSessions(userId);
    return { sessions: sessions.map((s) => this.formatSession(s)) };
  }

  /** Admin: force-sign-out a user from every device. */
  async revokeAllSessions(userId: string) {
    await this.repo.revokeAllUserTokens(userId);
    return { message: 'Signed the user out of all devices.' };
  }

  async logout(userId: string) {
    await this.repo.revokeAllUserTokens(userId);
  }

  /**
   * Self-service password reset, step 1. Deliberately silent about outcomes:
   * unknown email, inactive user, or unconfigured SMTP all "succeed" from the
   * caller's perspective. Returns whether a code was actually emailed so the
   * controller can log it — never so it can be surfaced to the client.
   */
  async forgotPassword(facilityId: string, email: string, requestedIp?: string): Promise<{ sent: boolean }> {
    const user = await this.repo.findUserByEmail(facilityId, email);
    if (!user || !user.isActive) return { sent: false };

    const facility = await this.prisma.facility.findUnique({ where: { id: facilityId } });
    const config = facility ? mailConfigFromSettings(facility.settings) : null;
    if (!facility || !config) return { sent: false };

    const code = await this.otp.issue(user.id, facilityId, 'PASSWORD_RESET', requestedIp);
    try {
      await this.mail.send(config, {
        to: user.email,
        subject: 'Your ColdChain password reset code',
        template: 'otp-code',
        context: {
          facilityName: facility.name,
          purposeLabel: 'Password reset code',
          code,
          expiresMinutes: OTP_TTL_MINUTES,
        },
      });
      return { sent: true };
    } catch {
      return { sent: false };
    }
  }

  /** Self-service password reset, step 2: verify the emailed code and rotate. */
  async resetPassword(facilityId: string, email: string, code: string, newPassword: string) {
    // Policy check FIRST: the rejection is then identical whether or not the
    // account exists (no enumeration through the error shape), and a rejected
    // password never consumes the single-use code — the user can retry the
    // same code with a better password.
    const policy = validateNewPassword(newPassword, { minLength: passwordMinLength() });
    if (!policy.ok) throw Errors.VALIDATION_ERROR(policy.reason!);

    const user = await this.repo.findUserByEmail(facilityId, email);
    if (!user || !user.isActive) throw Errors.AUTH_INVALID('Invalid or expired code');

    const ok = await this.otp.verifyAndConsume(user.id, 'PASSWORD_RESET', code);
    if (!ok) throw Errors.AUTH_INVALID('Invalid or expired code');

    const passwordHash = await hashPassword(newPassword);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, failedLoginCount: 0, lockedUntil: null, mustChangePassword: false },
    });
    await this.repo.revokeAllUserTokens(user.id);
    return { message: 'Password has been reset. You can now log in.' };
  }

  async me(userId: string) {
    const user = await this.repo.findUserById(userId);
    if (!user) throw Errors.AUTH_INVALID('User not found');
    const totpActive = AuthService.totpActive(user);
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      name_urdu: user.nameUrdu,
      role: user.role,
      facility_id: user.facilityId,
      must_change_password: user.mustChangePassword,
      two_factor_enabled: user.twoFactorEnabled || totpActive,
      two_factor_method: totpActive ? ('totp' as const) : user.twoFactorEnabled ? ('email' as const) : null,
      backup_codes_remaining: totpActive ? await this.totp.remainingBackupCodes(userId) : null,
    };
  }
}
