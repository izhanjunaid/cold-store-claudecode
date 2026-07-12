import bcrypt from 'bcryptjs';
import type { PrismaClient } from '@coldchain/db';
import { AuthRepository } from './auth.repository';
import { OtpService, OTP_TTL_MINUTES } from './otp.service';
import { MailService, mailConfigFromSettings } from '../mail/mail.service';
import { signAccessToken, signRefreshToken } from '../../common/jwt';
import { Errors } from '../../common/errors';

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const BCRYPT_ROUNDS = 12;

export class AuthService {
  constructor(
    private readonly repo: AuthRepository,
    private readonly prisma: PrismaClient,
    private readonly otp: OtpService,
    private readonly mail: MailService,
  ) {}

  async login(facilityId: string, email: string, password: string) {
    const user = await this.repo.findUserByEmail(facilityId, email);
    if (!user || !user.isActive) {
      throw Errors.AUTH_INVALID('Invalid email or password');
    }

    // Check lockout
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw Errors.ACCOUNT_LOCKED();
    }

    // Verify password
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      const shouldLock = user.failedLoginCount + 1 >= MAX_FAILED_ATTEMPTS;
      await this.repo.incrementFailedLogins(
        user.id,
        shouldLock ? new Date(Date.now() + LOCK_DURATION_MS) : undefined,
      );
      throw Errors.AUTH_INVALID('Invalid email or password');
    }

    // Success — reset failed count, update last login
    await this.repo.updateLastLogin(user.id);

    // Generate tokens
    const accessToken = signAccessToken({
      userId: user.id,
      facilityId: user.facilityId,
      role: user.role,
    });

    const rawRefreshToken = AuthRepository.generateToken();
    const refreshTokenRecord = await this.repo.createRefreshToken(
      user.id,
      user.facilityId,
      rawRefreshToken,
    );

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

  async refresh(refreshTokenJwt: string) {
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

    // Issue new tokens
    const accessToken = signAccessToken({
      userId: user.id,
      facilityId: user.facilityId,
      role: user.role,
    });

    const rawRefreshToken = AuthRepository.generateToken();
    const newTokenRecord = await this.repo.createRefreshToken(
      user.id,
      user.facilityId,
      rawRefreshToken,
    );

    // Revoke old refresh token
    await this.repo.revokeRefreshToken(payload.tokenId).catch(() => {
      // Token may already be revoked
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
    const user = await this.repo.findUserByEmail(facilityId, email);
    if (!user || !user.isActive) throw Errors.AUTH_INVALID('Invalid or expired code');

    const ok = await this.otp.verifyAndConsume(user.id, 'PASSWORD_RESET', code);
    if (!ok) throw Errors.AUTH_INVALID('Invalid or expired code');

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
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
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      name_urdu: user.nameUrdu,
      role: user.role,
      facility_id: user.facilityId,
      must_change_password: user.mustChangePassword,
    };
  }
}
