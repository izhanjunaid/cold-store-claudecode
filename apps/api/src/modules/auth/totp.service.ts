import { generateSecret, generateURI, verify } from 'otplib';
import { createHash, randomInt } from 'crypto';
import type { PrismaClient } from '@coldchain/db';

// ±1 RFC 6238 time step (30s) of clock tolerance. The facility box must keep
// its clock NTP-sane to within ~30s or authenticator codes stop matching.
export const TOTP_EPOCH_TOLERANCE_SECONDS = 30;

export const BACKUP_CODE_COUNT = 8;

// Unambiguous alphabet: no I/O/0/1, so codes survive being read over the
// phone or copied from a printout.
const BACKUP_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function hashCode(code: string): string {
  return createHash('sha256').update(normalizeBackupCode(code)).digest('hex');
}

/** Uppercase and strip separators so 'ab3d-ef7h', 'AB3D EF7H' etc. all match. */
export function normalizeBackupCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function generateTotpSecret(): string {
  return generateSecret();
}

export function buildOtpauthUri(email: string, issuer: string, secret: string): string {
  return generateURI({ issuer, label: email, secret });
}

export async function verifyTotpToken(token: string, secret: string): Promise<boolean> {
  try {
    const result = await verify({ token, secret, epochTolerance: TOTP_EPOCH_TOLERANCE_SECONDS });
    return result.valid;
  } catch {
    return false;
  }
}

export function generateBackupCode(): string {
  const pick = () => BACKUP_CODE_ALPHABET[randomInt(0, BACKUP_CODE_ALPHABET.length)];
  const quad = () => Array.from({ length: 4 }, pick).join('');
  return `${quad()}-${quad()}`;
}

/** Shape check for a backup code (vs a 6-digit TOTP/email code) at login. */
export function looksLikeBackupCode(code: string): boolean {
  return normalizeBackupCode(code).length === 8 && !/^\d{6}$/.test(code.trim());
}

export class TotpService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Replace the user's backup codes with a fresh set. Returns the plaintext
   * codes — the only time they ever exist outside sha256 hashes.
   */
  async mintBackupCodes(userId: string, facilityId: string): Promise<string[]> {
    const codes = Array.from({ length: BACKUP_CODE_COUNT }, generateBackupCode);
    await this.prisma.$transaction([
      this.prisma.userBackupCode.deleteMany({ where: { userId } }),
      this.prisma.userBackupCode.createMany({
        data: codes.map((code) => ({ userId, facilityId, codeHash: hashCode(code) })),
      }),
    ]);
    return codes;
  }

  /**
   * Burn a backup code. Same atomic updateMany-with-guard pattern as
   * OtpService.verifyAndConsume — a concurrent second use loses the race.
   */
  async consumeBackupCode(userId: string, code: string): Promise<boolean> {
    const row = await this.prisma.userBackupCode.findFirst({
      where: { userId, codeHash: hashCode(code), usedAt: null },
    });
    if (!row) return false;
    const consumed = await this.prisma.userBackupCode.updateMany({
      where: { id: row.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    return consumed.count === 1;
  }

  async deleteBackupCodes(userId: string): Promise<void> {
    await this.prisma.userBackupCode.deleteMany({ where: { userId } });
  }

  /** Unused-code count, for the account page ("5 of 8 remaining"). */
  async remainingBackupCodes(userId: string): Promise<number> {
    return this.prisma.userBackupCode.count({ where: { userId, usedAt: null } });
  }
}
