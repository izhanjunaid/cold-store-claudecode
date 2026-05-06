import type { PrismaClient, Prisma } from '@coldchain/db';
import { Errors } from '../../common/errors';

type Tx = Prisma.TransactionClient;
type Db = PrismaClient | Tx;

export class PeriodLockService {
  constructor(private prisma: PrismaClient) {}

  async assertOpen(db: Db, facilityId: string, entryDate: Date): Promise<void> {
    const year = entryDate.getFullYear();
    const month = entryDate.getMonth() + 1;
    const lock = await db.periodLock.findFirst({
      where: {
        facilityId,
        periodYear: year,
        periodMonth: month,
        unlockedAt: null,
      },
    });
    if (lock) throw Errors.PERIOD_LOCKED();
  }

  async list(facilityId: string) {
    const locks = await this.prisma.periodLock.findMany({
      where: { facilityId },
      include: {
        lockedByUser: { select: { name: true } },
        unlockedByUser: { select: { name: true } },
      },
      orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }],
    });
    return locks.map((l) => ({
      id: l.id,
      facility_id: l.facilityId,
      period_year: l.periodYear,
      period_month: l.periodMonth,
      locked_at: l.lockedAt.toISOString(),
      locked_by_name: l.lockedByUser.name,
      unlocked_at: l.unlockedAt?.toISOString() ?? null,
      unlocked_by_name: l.unlockedByUser?.name ?? null,
      reason: l.reason,
      is_locked: l.unlockedAt === null,
    }));
  }

  async lock(facilityId: string, userId: string, year: number, month: number, reason?: string) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.periodLock.findUnique({
        where: { facilityId_periodYear_periodMonth: { facilityId, periodYear: year, periodMonth: month } },
      });
      if (existing && existing.unlockedAt === null) {
        throw Errors.PERIOD_ALREADY_LOCKED();
      }
      if (existing) {
        // Re-lock previously unlocked period — overwrite
        return tx.periodLock.update({
          where: { id: existing.id },
          data: {
            lockedAt: new Date(),
            lockedBy: userId,
            unlockedAt: null,
            unlockedBy: null,
            reason: reason ?? null,
          },
        });
      }
      return tx.periodLock.create({
        data: {
          facilityId,
          periodYear: year,
          periodMonth: month,
          lockedBy: userId,
          reason: reason ?? null,
        },
      });
    });
  }

  async unlock(facilityId: string, userId: string, year: number, month: number, reason: string) {
    const existing = await this.prisma.periodLock.findUnique({
      where: { facilityId_periodYear_periodMonth: { facilityId, periodYear: year, periodMonth: month } },
    });
    if (!existing || existing.unlockedAt !== null) {
      throw Errors.PERIOD_NOT_LOCKED();
    }
    return this.prisma.periodLock.update({
      where: { id: existing.id },
      data: {
        unlockedAt: new Date(),
        unlockedBy: userId,
        reason: reason,
      },
    });
  }
}
