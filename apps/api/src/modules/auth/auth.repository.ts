import type { PrismaClient } from '@coldchain/db';
import { createHash, randomBytes } from 'crypto';

export class AuthRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findUserByEmail(facilityId: string, email: string) {
    return this.prisma.user.findUnique({
      where: { facilityId_email: { facilityId, email } },
    });
  }

  async findUserById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async updateLastLogin(userId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { lastLoginAt: new Date(), failedLoginCount: 0, lockedUntil: null },
    });
  }

  async incrementFailedLogins(userId: string, lockUntil?: Date) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        failedLoginCount: { increment: 1 },
        ...(lockUntil ? { lockedUntil: lockUntil } : {}),
      },
    });
  }

  async createRefreshToken(
    userId: string,
    facilityId: string,
    token: string,
    meta?: { userAgent?: string | null; ip?: string | null },
  ) {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    return this.prisma.refreshToken.create({
      data: {
        userId,
        facilityId,
        tokenHash,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        userAgent: meta?.userAgent?.slice(0, 400) ?? null,
        ip: meta?.ip?.slice(0, 45) ?? null,
        lastUsedAt: new Date(),
      },
    });
  }

  async findRefreshToken(tokenHash: string) {
    return this.prisma.refreshToken.findFirst({
      where: {
        tokenHash,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: { user: true },
    });
  }

  async findRefreshTokenById(id: string) {
    return this.prisma.refreshToken.findUnique({ where: { id } });
  }

  /**
   * Revoke a token because it was superseded by rotation. rotatedAt marks it
   * as rotation-revoked — the ONLY kind of revoked token whose replay is a
   * theft signal (see AuthService.refresh reuse detection). All other revoke
   * paths (logout, session revoke, password change) leave rotatedAt null.
   */
  async revokeRefreshToken(id: string) {
    const now = new Date();
    return this.prisma.refreshToken.update({
      where: { id },
      data: { revokedAt: now, rotatedAt: now },
    });
  }

  async revokeAllUserTokens(userId: string) {
    return this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Live (unrevoked, unexpired) sessions for a user, most-recently-used first. */
  async listActiveSessions(userId: string) {
    return this.prisma.refreshToken.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: [{ lastUsedAt: 'desc' }, { createdAt: 'desc' }],
      select: { id: true, userAgent: true, ip: true, createdAt: true, lastUsedAt: true },
    });
  }

  /** Revoke a single session, but only if it belongs to this user. */
  async revokeUserToken(userId: string, id: string) {
    return this.prisma.refreshToken.updateMany({
      where: { id, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Revoke every live session for a user except the one being kept. */
  async revokeOtherUserTokens(userId: string, keepId: string) {
    return this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null, id: { not: keepId } },
      data: { revokedAt: new Date() },
    });
  }

  /** Bump last_used_at on a live session (called when its token is refreshed). */
  async touchRefreshToken(id: string) {
    return this.prisma.refreshToken.update({
      where: { id },
      data: { lastUsedAt: new Date() },
    });
  }

  static hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  static generateToken(): string {
    return randomBytes(48).toString('hex');
  }
}
