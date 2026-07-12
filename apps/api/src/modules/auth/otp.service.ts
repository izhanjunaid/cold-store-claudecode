import type { PrismaClient, OtpPurpose } from '@coldchain/db';
import { createHash, randomInt } from 'crypto';

export const OTP_TTL_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

/**
 * Issue/verify short-lived 6-digit email codes. One live code per
 * (user, purpose): issuing invalidates prior unconsumed codes; verification
 * is single-use and capped at OTP_MAX_ATTEMPTS wrong guesses.
 */
export class OtpService {
  constructor(private readonly prisma: PrismaClient) {}

  async issue(userId: string, facilityId: string, purpose: OtpPurpose, requestedIp?: string): Promise<string> {
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    await this.prisma.otpCode.updateMany({
      where: { userId, purpose, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    await this.prisma.otpCode.create({
      data: {
        userId,
        facilityId,
        purpose,
        codeHash: hashCode(code),
        expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000),
        requestedIp: requestedIp ?? null,
      },
    });
    return code;
  }

  async verifyAndConsume(userId: string, purpose: OtpPurpose, code: string): Promise<boolean> {
    const row = await this.prisma.otpCode.findFirst({
      where: { userId, purpose, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!row) return false;

    if (row.attemptCount >= OTP_MAX_ATTEMPTS) {
      await this.prisma.otpCode.update({ where: { id: row.id }, data: { consumedAt: new Date() } });
      return false;
    }

    if (row.codeHash !== hashCode(code)) {
      await this.prisma.otpCode.update({ where: { id: row.id }, data: { attemptCount: { increment: 1 } } });
      return false;
    }

    // updateMany with the consumedAt guard makes consumption atomic — a
    // concurrent second use of the same code loses the race and fails.
    const consumed = await this.prisma.otpCode.updateMany({
      where: { id: row.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    return consumed.count === 1;
  }
}
