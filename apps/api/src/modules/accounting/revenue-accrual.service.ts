import type { PrismaClient, Prisma } from '@coldchain/db';
import { Errors } from '../../common/errors';
import { advisoryXactLock } from '../../common/advisory-lock';
import { computeStorageCharge } from '../invoice/storage-charge';
import { resolveFacilitySettings } from '../facility/facility.service';
import { revenueAccountForCommodity } from './templates/types';
import {
  buildJE25RevenueAccrual,
  buildJE25Reversal,
  type AccrualLotShare,
} from './templates/je-25-revenue-accrual';
import type { JournalEntryService } from './journal-entry.service';

const SOURCE_TABLE = 'revenue_accrual';
const DAY_MS = 1000 * 60 * 60 * 24;

/** UTC day boundaries, matching @db.Date truncation used everywhere else. */
const periodEndDate = (year: number, month: number) => new Date(Date.UTC(year, month, 0));
const periodStartDate = (year: number, month: number) => new Date(Date.UTC(year, month - 1, 1));
const daysBetween = (from: Date, to: Date) => (to.getTime() - from.getTime()) / DAY_MS;

export type UnaccruableLot = { lot_number: string; reason: string };

export type AccrualPreview = {
  period_year: number;
  period_month: number;
  period_end: string;
  lots: Array<{
    lot_id: string;
    lot_number: string;
    party_name: string;
    commodity_name: string;
    bags: number;
    days_in_storage: number;
    revenue_account_code: string;
    accrued_to_date_pkr: number;
  }>;
  total_pkr: number;
  unaccruable: UnaccruableLot[];
  already_run: boolean;
};

type LotForAccrual = Prisma.LotGetPayload<{
  include: {
    ratePlan: true;
    commodity: { select: { name: true } };
    ownerParty: { select: { name: true } };
    ownershipHistory: true;
  };
}>;

export class RevenueAccrualService {
  constructor(
    private prisma: PrismaClient,
    private journal: JournalEntryService,
  ) {}

  /**
   * What one lot has earned from the start of its billing period through
   * `periodEnd` — cumulative, not the month's own slice.
   *
   * The billing period start must match what the invoice will eventually use
   * (invoice.builder.ts:123-125: latest INITIAL/TRANSFER_IN ownership date,
   * else the lot's inbound date), or the accrual and the invoice never
   * converge and the difference sits in 1250 forever.
   */
  private earnedToDate(
    lot: LotForAccrual,
    periodEnd: Date,
  ): { amountPkr: number; days: number; periodStart: Date } | { unaccruable: string } {
    const latestOwnership = [...lot.ownershipHistory]
      .filter((h) => h.eventType === 'INITIAL' || h.eventType === 'TRANSFER_IN')
      .sort((a, b) => b.effectiveDate.getTime() - a.effectiveDate.getTime())[0];
    const periodStart = latestOwnership ? latestOwnership.effectiveDate : lot.inboundDate;

    const plan = lot.ratePlan;
    const bags = lot.currentBalanceBags;

    if (plan.rateType === 'SEASONAL_PER_BAG') {
      // computeStorageCharge returns a FLAT amount for a seasonal plan,
      // independent of elapsed days. Feeding it a cumulative window would
      // recognise the entire season's fee at the first period end — the same
      // misstatement as today, only front-loaded instead of back-loaded. So
      // spread it across the season window the rate plan itself defines.
      if (!plan.seasonEndDate) {
        return {
          unaccruable:
            'seasonal rate plan has no season end date, so the fee cannot be spread over a known term',
        };
      }
      const spreadStart =
        plan.seasonStartDate && plan.seasonStartDate > periodStart ? plan.seasonStartDate : periodStart;
      const totalDays = daysBetween(spreadStart, plan.seasonEndDate);
      if (totalDays <= 0) {
        return { unaccruable: 'seasonal rate plan ends on or before the lot entered storage' };
      }
      const elapsed = daysBetween(spreadStart, periodEnd);
      const fraction = Math.min(Math.max(elapsed / totalDays, 0), 1);
      const full = bags * Number(plan.rateAmountPkr);
      return {
        amountPkr: Math.round(full * fraction * 100) / 100,
        days: Math.max(Math.ceil(elapsed), 0),
        periodStart,
      };
    }

    const charge = computeStorageCharge({
      rateType: plan.rateType,
      rateAmountPkr: Number(plan.rateAmountPkr),
      quantityBags: bags,
      periodStart,
      periodEnd,
      minBillingDays: plan.minBillingDays,
    });
    return { amountPkr: charge.amountPkr, days: charge.days, periodStart };
  }

  private async lotsInStorage(facilityId: string, periodEnd: Date): Promise<LotForAccrual[]> {
    return this.prisma.lot.findMany({
      where: {
        facilityId,
        status: 'ACTIVE',
        // The accrual is an official-book concern; KATCHI is the informal
        // ledger and is not what the statements present.
        bookType: 'PACCI',
        currentBalanceBags: { gt: 0 },
        inboundDate: { lte: periodEnd },
      },
      include: {
        ratePlan: true,
        commodity: { select: { name: true } },
        ownerParty: { select: { name: true } },
        ownershipHistory: true,
      },
      orderBy: { lotNumber: 'asc' },
    });
  }

  async preview(facilityId: string, year: number, month: number): Promise<AccrualPreview> {
    const periodEnd = periodEndDate(year, month);
    const lots = await this.lotsInStorage(facilityId, periodEnd);

    const rows: AccrualPreview['lots'] = [];
    const unaccruable: UnaccruableLot[] = [];

    for (const lot of lots) {
      const earned = this.earnedToDate(lot, periodEnd);
      if ('unaccruable' in earned) {
        unaccruable.push({ lot_number: lot.lotNumber, reason: earned.unaccruable });
        continue;
      }
      if (earned.periodStart > periodEnd || earned.amountPkr <= 0) continue;
      rows.push({
        lot_id: lot.id,
        lot_number: lot.lotNumber,
        party_name: lot.ownerParty.name,
        commodity_name: lot.commodity.name,
        bags: lot.currentBalanceBags,
        days_in_storage: earned.days,
        revenue_account_code:
          lot.ratePlan.revenueAccountCode ?? revenueAccountForCommodity(lot.commodity.name),
        accrued_to_date_pkr: earned.amountPkr,
      });
    }

    return {
      period_year: year,
      period_month: month,
      period_end: periodEnd.toISOString().slice(0, 10),
      lots: rows,
      total_pkr: Math.round(rows.reduce((s, r) => s + r.accrued_to_date_pkr, 0) * 100) / 100,
      unaccruable,
      already_run: await this.hasAccrualFor(this.prisma, facilityId, year, month),
    };
  }

  private async hasAccrualFor(
    db: PrismaClient | Prisma.TransactionClient,
    facilityId: string,
    year: number,
    month: number,
  ): Promise<boolean> {
    return (
      (await db.journalEntry.count({
        where: {
          facilityId,
          sourceTable: SOURCE_TABLE,
          entryType: 'ACCRUAL',
          periodYear: year,
          periodMonth: month,
          postingStatus: 'POSTED',
        },
      })) > 0
    );
  }

  /**
   * Post the period's accrual, reversing the previous one first.
   *
   * Ordering matters and is one-way: postInTransaction calls
   * periodLock.assertOpen, and the lock is a closed-through watermark, so once
   * a month is locked no earlier month can ever be accrued or corrected.
   * Accrue, then lock — never the other way round.
   */
  async run(facilityId: string, userId: string, year: number, month: number) {
    const facility = await this.prisma.facility.findUnique({ where: { id: facilityId } });
    if (!facility) throw Errors.VALIDATION_ERROR('Facility not found', 'facility_id');
    const settings = resolveFacilitySettings(facility.settings);
    const rule = settings.revenue_accrual;

    if (!rule.enabled) {
      throw Errors.VALIDATION_ERROR(
        'Revenue accrual is switched off for this facility. Enable it in settings, ideally from a fiscal-year boundary so already-reported periods are not restated.',
        'revenue_accrual',
      );
    }
    const periodEnd = periodEndDate(year, month);
    if (rule.start_date && periodEnd < new Date(`${rule.start_date}T00:00:00.000Z`)) {
      throw Errors.VALIDATION_ERROR(
        `Revenue accrual starts from ${rule.start_date}; ${year}-${String(month).padStart(2, '0')} is before that.`,
        'period',
      );
    }

    const lots = await this.lotsInStorage(facilityId, periodEnd);
    const shares: AccrualLotShare[] = [];
    const unaccruable: UnaccruableLot[] = [];
    for (const lot of lots) {
      const earned = this.earnedToDate(lot, periodEnd);
      if ('unaccruable' in earned) {
        unaccruable.push({ lot_number: lot.lotNumber, reason: earned.unaccruable });
        continue;
      }
      if (earned.periodStart > periodEnd || earned.amountPkr <= 0) continue;
      shares.push({
        lotId: lot.id,
        lotNumber: lot.lotNumber,
        revenueAccountCode:
          lot.ratePlan.revenueAccountCode ?? revenueAccountForCommodity(lot.commodity.name),
        amountPkr: earned.amountPkr,
      });
    }

    return this.prisma.$transaction(async (tx) => {
      // Serialise per period. The result is immutable by trigger, so a double
      // post could not be edited back out — same reasoning as opening balances.
      await advisoryXactLock(tx, `${facilityId}:accrual:${year}-${month}`);

      if (await this.hasAccrualFor(tx, facilityId, year, month)) {
        throw Errors.VALIDATION_ERROR(
          `Storage revenue has already been accrued for ${year}-${String(month).padStart(2, '0')}.`,
          'period',
        );
      }

      // Reverse the previous accrual, if one is still standing. "Standing"
      // means no reversal has been posted after it — derived from the entries
      // themselves rather than a flag, since marking the original REVERSED
      // would drop it out of every statement query (all of which filter
      // POSTED) and erase the revenue from the period it belonged to.
      const prior = await tx.journalEntry.findFirst({
        where: {
          facilityId,
          sourceTable: SOURCE_TABLE,
          entryType: 'ACCRUAL',
          postingStatus: 'POSTED',
          entryDate: { lt: periodEnd },
        },
        orderBy: { entryDate: 'desc' },
        include: { lines: true },
      });

      let reversalNumber: string | null = null;
      if (prior) {
        const alreadyReversed = await tx.journalEntry.count({
          where: {
            facilityId,
            sourceTable: SOURCE_TABLE,
            entryType: 'ADJUSTMENT',
            postingStatus: 'POSTED',
            entryDate: { gt: prior.entryDate },
          },
        });
        if (alreadyReversed === 0) {
          const reversal = await this.journal.postInTransaction(
            tx,
            facilityId,
            userId,
            buildJE25Reversal({
              facilityId,
              bookType: 'PACCI',
              reversalDate: periodStartDate(year, month),
              accruedEntryNumber: prior.entryNumber,
              lines: prior.lines.map((l) => ({
                accountCode: l.accountCode,
                debitAmount: Number(l.debitAmount),
                creditAmount: Number(l.creditAmount),
                lotId: l.lotId,
              })),
            }),
          );
          reversalNumber = reversal.entryNumber;
        }
      }

      if (shares.length === 0) {
        return {
          accrued_entry_number: null,
          reversal_entry_number: reversalNumber,
          total_pkr: 0,
          lot_count: 0,
          unaccruable,
        };
      }

      const accrual = await this.journal.postInTransaction(
        tx,
        facilityId,
        userId,
        buildJE25RevenueAccrual({ periodEnd, bookType: 'PACCI', facilityId, shares }),
      );

      return {
        accrued_entry_number: accrual.entryNumber,
        reversal_entry_number: reversalNumber,
        total_pkr: Math.round(shares.reduce((s, r) => s + r.amountPkr, 0) * 100) / 100,
        lot_count: shares.length,
        unaccruable,
      };
    });
  }

}
