import type { PrismaClient, Prisma } from '@coldchain/db';
import { Errors } from '../../common/errors';
import { periodOf } from '@coldchain/shared';
import { advisoryXactLock } from '../../common/advisory-lock';
import { JournalEntryService } from './journal-entry.service';
import { RevenueAccrualService } from './revenue-accrual.service';

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
    if (!(await this.isOpen(db, facilityId, entryDate))) throw Errors.PERIOD_LOCKED();
  }

  async isOpen(db: Db, facilityId: string, date: Date): Promise<boolean> {
    const { month, year } = periodOf(date);
    const explicit = await db.periodLock.findUnique({
      where: { facilityId_periodYear_periodMonth: { facilityId, periodYear: year, periodMonth: month } },
    });
    // An explicit unlock row is a reopen exception below the watermark.
    if (explicit) return explicit.unlockedAt !== null;
    return !(await this.hasActiveLockAtOrAbove(db, facilityId, year, month));
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

  /**
   * Close a month. Closing is the month-end: every draft invoice dated in the month
   * must be finalised first (its revenue belongs to the month), and the storage
   * revenue earned but not yet billed is accrued — with its reversal — before the
   * lock goes on (docs/25 Q2, L-04, R-09). Months before the accrual start date
   * lock without an accrual.
   */
  async lock(facilityId: string, userId: string, year: number, month: number, reason?: string) {
    return this.prisma.$transaction(async (tx) => {
      // Two closes of the same month: the second waits, then finds it locked.
      await advisoryXactLock(tx, `${facilityId}:period-lock:${year}-${month}`);
      const existing = await tx.periodLock.findUnique({
        where: { facilityId_periodYear_periodMonth: { facilityId, periodYear: year, periodMonth: month } },
      });
      if (existing && existing.unlockedAt === null) {
        throw Errors.PERIOD_ALREADY_LOCKED();
      }

      const drafts = await tx.invoice.count({
        where: {
          facilityId,
          status: 'DRAFT',
          invoiceDate: { gte: new Date(Date.UTC(year, month - 1, 1)), lte: new Date(Date.UTC(year, month, 0)) },
        },
      });
      if (drafts > 0) {
        throw Errors.VALIDATION_ERROR(
          `${drafts} draft invoice(s) are dated in this month; finalise them before closing it`,
          'period',
        );
      }
      await new RevenueAccrualService(this.prisma, new JournalEntryService(this.prisma, this)).accrueForClose(
        tx,
        facilityId,
        userId,
        year,
        month,
      );
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
      // The close reads every lot and posts the accrual and its reversal; the 5 s
      // interactive-transaction default is too short for a full store.
    }, { timeout: 60_000, maxWait: 10_000 });
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
