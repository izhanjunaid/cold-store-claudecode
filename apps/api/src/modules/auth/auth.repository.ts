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

  async createRefreshToken(userId: string, facilityId: string, token: string) {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    return this.prisma.refreshToken.create({
      data: {
        userId,
        facilityId,
        tokenHash,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
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

  async revokeRefreshToken(id: string) {
    return this.prisma.refreshToken.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllUserTokens(userId: string) {
    return this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  static hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  static generateToken(): string {
    return randomBytes(48).toString('hex');
  }
}
