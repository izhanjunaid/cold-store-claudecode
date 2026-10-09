import type { PrismaClient, Prisma } from '@coldchain/db';
import { addDays, fromIsoDate, round2, toIsoDate } from '@coldchain/shared';
import { advisoryXactLock } from '../../common/advisory-lock';
import { computeStorageCharge, billingPeriodStart } from '../invoice/storage-charge';
import { resolveFacilitySettings } from '../facility/facility.service';
import { buildJE25RevenueAccrual, type AccrualLotShare } from './templates/je-25-revenue-accrual';
import type { JournalEntryService } from './journal-entry.service';

type Db = PrismaClient | Prisma.TransactionClient;

const SOURCE_TABLE = 'revenue_accrual';
const DAY_MS = 1000 * 60 * 60 * 24;

/** UTC day boundaries, matching @db.Date truncation used everywhere else. */
const periodEndDate = (year: number, month: number) => new Date(Date.UTC(year, month, 0));
const daysBetween = (from: Date, to: Date) => (to.getTime() - from.getTime()) / DAY_MS;
const later = (a: Date, b: Date) => (a > b ? a : b);

export type UnaccruableLot = { lot_number: string; reason: string };

export type AccrualPreview = {
  period_year: number;
  period_month: number;
  period_end: string;
  /** Accrual applies from this date; null means the facility has not set it yet. */
  start_date: string | null;
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

export type AccrualResult = {
  accrued_entry_number: string | null;
  reversal_entry_number: string | null;
  total_pkr: number;
  lot_count: number;
  unaccruable: UnaccruableLot[];
};

const lotInclude = {
  ratePlan: true,
  commodity: { select: { name: true, revenueAccountCode: true } },
  ownerParty: { select: { name: true } },
  ownershipHistory: { select: { eventType: true, effectiveDate: true } },
  outboundEvents: { where: { status: 'DISPATCHED' as const }, select: { outboundDate: true, quantityWithdrawnBags: true } },
  childLots: { select: { inboundDate: true, quantityBags: true } },
} satisfies Prisma.LotInclude;

type LotForAccrual = Prisma.LotGetPayload<{ include: typeof lotInclude }>;

type Share = {
  lot: LotForAccrual;
  bags: number;
  days: number;
  revenueAccountCode: string;
  amountPkr: number;
};

/**
 * Storage revenue is recognised as it is earned, month by month — the fixed
 * policy from the facility's `revenue_accrual.start_date` (docs/25 Q2, IFRS for
 * SMEs s.23; there is no on/off switch). No start date means no accrual yet.
 *
 * Each month-end, when the month is locked, the storage earned but not yet
 * billed is accrued (JE-25: DR 1250 / CR storage revenue), cumulative from each
 * lot's billing start (never before the start date), for the bags and the owner
 * the lot had AT that month-end — and its reversal is posted in the same step,
 * dated the first of the next month. Every accrual therefore nets to zero in the
 * following month, whatever happens later: the invoice that eventually bills the
 * storage books the revenue, and nothing is ever counted twice (L-04, R-16).
 */
export class RevenueAccrualService {
  constructor(
    private prisma: PrismaClient,
    private journal: JournalEntryService,
  ) {}

  private async startDate(db: Db, facilityId: string): Promise<Date | null> {
    const facility = await db.facility.findUnique({ where: { id: facilityId }, select: { settings: true } });
    const start = resolveFacilitySettings(facility?.settings ?? null).revenue_accrual.start_date;
    return start ? fromIsoDate(start) : null;
  }

  /** Storage earned but not yet billed on each lot at `periodEnd`, from `from` at the earliest. */
  private async shares(db: Db, facilityId: string, periodEnd: Date, from: Date) {
    const lots = await db.lot.findMany({
      where: { facilityId, bookType: 'PACCI', inboundDate: { lte: periodEnd } },
      include: lotInclude,
      orderBy: { lotNumber: 'asc' },
    });

    const shares: Share[] = [];
    const unaccruable: UnaccruableLot[] = [];
    for (const lot of lots) {
      // The lot as it stood at the month-end, not as it stands today.
      const bags =
        lot.quantityBags -
        lot.outboundEvents.filter((o) => o.outboundDate <= periodEnd).reduce((s, o) => s + o.quantityWithdrawnBags, 0) -
        lot.childLots.filter((c) => c.inboundDate <= periodEnd).reduce((s, c) => s + c.quantityBags, 0);
      if (bags <= 0) continue;
      const billingStart = billingPeriodStart({
        inboundDate: lot.inboundDate,
        ownershipHistory: lot.ownershipHistory.filter((h) => h.effectiveDate <= periodEnd),
      });
      const windowStart = later(billingStart, from);
      if (windowStart > periodEnd) continue;

      const revenueAccountCode = lot.ratePlan.revenueAccountCode ?? lot.commodity.revenueAccountCode;
      if (!revenueAccountCode) throw new Error(`Commodity of lot ${lot.lotNumber} has no revenue account`);

      const plan = lot.ratePlan;
      if (plan.rateType === 'SEASONAL_PER_BAG') {
        // A seasonal fee is flat, so it is spread over the season the plan defines.
        if (!plan.seasonEndDate) {
          unaccruable.push({
            lot_number: lot.lotNumber,
            reason: 'seasonal rate plan has no season end date, so the fee cannot be spread over a known term',
          });
          continue;
        }
        const spreadStart = plan.seasonStartDate && plan.seasonStartDate > billingStart ? plan.seasonStartDate : billingStart;
        const totalDays = daysBetween(spreadStart, plan.seasonEndDate);
        if (totalDays <= 0) {
          unaccruable.push({ lot_number: lot.lotNumber, reason: 'seasonal rate plan ends on or before the lot entered storage' });
          continue;
        }
        const fraction = (d: Date) => Math.min(Math.max(daysBetween(spreadStart, d) / totalDays, 0), 1);
        const full = bags * Number(plan.rateAmountPkr);
        // Only what was earned inside the accrual window.
        const amountPkr = round2(full * (fraction(periodEnd) - fraction(windowStart)));
        if (amountPkr > 0) {
          shares.push({ lot, bags, days: Math.ceil(daysBetween(windowStart, periodEnd)), revenueAccountCode, amountPkr });
        }
        continue;
      }

      const charge = computeStorageCharge({
        rateType: plan.rateType,
        rateAmountPkr: Number(plan.rateAmountPkr),
        quantityBags: bags,
        periodStart: windowStart,
        periodEnd,
        minBillingDays: plan.minBillingDays,
      });
      if (charge.amountPkr > 0) {
        shares.push({ lot, bags, days: charge.days, revenueAccountCode, amountPkr: charge.amountPkr });
      }
    }
    return { shares, unaccruable };
  }

  private async hasAccrualFor(db: Db, facilityId: string, year: number, month: number): Promise<boolean> {
    return (
      (await db.journalEntry.count({
        where: { facilityId, sourceTable: SOURCE_TABLE, entryType: 'ACCRUAL', periodYear: year, periodMonth: month, postingStatus: 'POSTED' },
      })) > 0
    );
  }

  async preview(facilityId: string, year: number, month: number): Promise<AccrualPreview> {
    const periodEnd = periodEndDate(year, month);
    const start = await this.startDate(this.prisma, facilityId);
    const base = {
      period_year: year,
      period_month: month,
      period_end: toIsoDate(periodEnd),
      start_date: start ? toIsoDate(start) : null,
      already_run: await this.hasAccrualFor(this.prisma, facilityId, year, month),
    };
    if (!start || periodEnd < start) return { ...base, lots: [], total_pkr: 0, unaccruable: [] };

    const { shares, unaccruable } = await this.shares(this.prisma, facilityId, periodEnd, start);
    return {
      ...base,
      lots: shares.map((s) => ({
        lot_id: s.lot.id,
        lot_number: s.lot.lotNumber,
        party_name: s.lot.ownerParty.name,
        commodity_name: s.lot.commodity.name,
        bags: s.bags,
        days_in_storage: s.days,
        revenue_account_code: s.revenueAccountCode,
        accrued_to_date_pkr: s.amountPkr,
      })),
      total_pkr: round2(shares.reduce((s, r) => s + r.amountPkr, 0)),
      unaccruable,
    };
  }

  /**
   * The month-end accrual, run by the month lock inside its own transaction
   * (PeriodLockService.lock) — so a month can never close without it. Returns
   * null when there is nothing to do: no start date yet, a month before it, or
   * an accrual already posted for the month.
   */
  async accrueForClose(tx: Prisma.TransactionClient, facilityId: string, userId: string, year: number, month: number): Promise<AccrualResult | null> {
    const start = await this.startDate(tx, facilityId);
    const periodEnd = periodEndDate(year, month);
    if (!start || periodEnd < start) return null;

    await advisoryXactLock(tx, `${facilityId}:accrual:${year}-${month}`);
    if (await this.hasAccrualFor(tx, facilityId, year, month)) return null;

    const { shares, unaccruable } = await this.shares(tx, facilityId, periodEnd, start);
    if (shares.length === 0) {
      return { accrued_entry_number: null, reversal_entry_number: null, total_pkr: 0, lot_count: 0, unaccruable };
    }

    const accrual = await this.journal.postInTransaction(
      tx,
      facilityId,
      userId,
      buildJE25RevenueAccrual({
        periodEnd,
        bookType: 'PACCI',
        facilityId,
        shares: shares.map<AccrualLotShare>((s) => ({
          lotId: s.lot.id,
          lotNumber: s.lot.lotNumber,
          revenueAccountCode: s.revenueAccountCode,
          amountPkr: s.amountPkr,
        })),
      }),
    );
    // Posted with its reversal, so no later run (or its absence) can leave it standing.
    const reversal = await this.journal.reverseInTransaction(tx, facilityId, userId, accrual.id, {
      reason: 'accrued storage revenue reverses the next month',
      date: fromIsoDate(addDays(toIsoDate(periodEnd), 1)),
    });

    return {
      accrued_entry_number: accrual.entryNumber,
      reversal_entry_number: reversal.entryNumber,
      total_pkr: round2(shares.reduce((s, r) => s + r.amountPkr, 0)),
      lot_count: shares.length,
      unaccruable,
    };
  }
}
