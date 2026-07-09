import type { PrismaClient, Prisma } from '@coldchain/db';
import { Errors } from '../../common/errors';
import { derivePeriod } from './period';

type Tx = Prisma.TransactionClient;
type Db = PrismaClient | Tx;

export class PeriodLockService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Closed-through watermark (audit F-4): the maximum actively-locked period
   * closes every period at or below it — months nobody ever locked included.
   * A month below the watermark is only open while it carries an explicit
   * unlock row (reopen exception, OWNER-created via unlock()).
   */
  async assertOpen(db: Db, facilityId: string, entryDate: Date): Promise<void> {
    const { month, year } = derivePeriod(entryDate);
    const explicit = await db.periodLock.findUnique({
      where: { facilityId_periodYear_periodMonth: { facilityId, periodYear: year, periodMonth: month } },
    });
    if (explicit) {
      if (explicit.unlockedAt === null) throw Errors.PERIOD_LOCKED();
      return; // explicit reopen exception
    }
    if (await this.hasActiveLockAtOrAbove(db, facilityId, year, month)) {
      throw Errors.PERIOD_LOCKED();
    }
  }

  /** True when some period >= (year, month) is actively locked — i.e. the watermark covers this period. */
  private async hasActiveLockAtOrAbove(db: Db, facilityId: string, year: number, month: number): Promise<boolean> {
    const lock = await db.periodLock.findFirst({
      where: {
        facilityId,
        unlockedAt: null,
        OR: [{ periodYear: { gt: year } }, { periodYear: year, periodMonth: { gte: month } }],
      },
    });
    return lock !== null;
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
    // Transaction so the audit trigger sees the acting user (F-2b).
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.periodLock.findUnique({
        where: { facilityId_periodYear_periodMonth: { facilityId, periodYear: year, periodMonth: month } },
      });
      if (!existing) {
        // No row of its own — the month may still be closed by the watermark
        // (F-4). Reopening it materializes an explicit unlock-exception row.
        if (!(await this.hasActiveLockAtOrAbove(tx, facilityId, year, month))) {
          throw Errors.PERIOD_NOT_LOCKED();
        }
        const now = new Date();
        return tx.periodLock.create({
          data: {
            facilityId,
            periodYear: year,
            periodMonth: month,
            lockedAt: now,
            lockedBy: userId,
            unlockedAt: now,
            unlockedBy: userId,
            reason,
          },
        });
      }
      if (existing.unlockedAt !== null) {
        throw Errors.PERIOD_NOT_LOCKED();
      }
      return tx.periodLock.update({
        where: { id: existing.id },
        data: {
          unlockedAt: new Date(),
          unlockedBy: userId,
          reason: reason,
        },
      });
    });
  }
}
