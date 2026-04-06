import bcrypt from 'bcryptjs';
import { AuthRepository } from './auth.repository';
import { signAccessToken, signRefreshToken } from '../../common/jwt';
import { Errors } from '../../common/errors';

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes

export class AuthService {
  constructor(private readonly repo: AuthRepository) {}

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
    };
  }
}
