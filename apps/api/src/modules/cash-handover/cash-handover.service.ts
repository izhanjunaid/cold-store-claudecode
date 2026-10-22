import type { Prisma, PrismaClient } from '@coldchain/db';
import {
  addDays,
  businessDate,
  businessDayStart,
  fromIsoDate,
  round2,
  toIsoDate,
  type CashHandoverListQueryType,
  type CreateCashHandoverRequestType,
} from '@coldchain/shared';
import { Errors } from '../../common/errors';
import { advisoryXactLock } from '../../common/advisory-lock';
import { documentNumberPrefix, nextDocumentNumber } from '../../common/document-number';
import { lockRow } from '../../common/row-lock';
import { resolveFacilitySettings } from '../facility/facility.service';
import type { JournalEntryService } from '../accounting/journal-entry.service';
import { postedEntryNumber } from '../accounting/journal-entry.service';
import { buildJE28CashVariance } from '../accounting/templates/je-28-cash-variance';

type Db = PrismaClient | Prisma.TransactionClient;

/** The first business day whose cash is tracked, or null while tracking is off. */
async function trackingFrom(db: Db, facilityId: string): Promise<string | null> {
  const facility = await db.facility.findUnique({ where: { id: facilityId }, select: { settings: true } });
  return resolveFacilitySettings(facility?.settings ?? null).cash_tracking_from;
}

export type PendingCash = {
  collectorId: string;
  expectedPkr: number;
  receipts: { id: string }[];
  /** Oldest receipt in the pool, as a business day. */
  since: string;
};

/**
 * The cash waiting to be handed over, per collector: CASH receipts (PACCI, net of tax withheld —
 * the cash that actually arrived, loan allocations included because that cash is in the drawer
 * too) recorded on or after the tracking day and not yet in any handover. Keyed on `created_at`,
 * the moment the money was taken; `payment_date` can be any day in an open period. The owner's
 * own cash is not tracked: there is nobody above them to count it.
 */
export async function pendingCash(
  db: Db,
  facilityId: string,
  from: string,
  collectorId?: string,
): Promise<Map<string, PendingCash>> {
  const owners = (await db.user.findMany({ where: { facilityId, role: 'OWNER' }, select: { id: true } })).map((u) => u.id);
  if (collectorId && owners.includes(collectorId)) return new Map();
  const rows = await db.payment.findMany({
    where: {
      facilityId,
      paymentMethod: 'CASH',
      bookType: 'PACCI',
      createdAt: { gte: businessDayStart(from) },
      cashHandover: null,
      createdBy: collectorId ?? { notIn: owners },
    },
    select: { id: true, createdBy: true, amountPkr: true, taxWithheldPkr: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  const byCollector = new Map<string, PendingCash>();
  for (const r of rows) {
    const entry = byCollector.get(r.createdBy) ?? {
      collectorId: r.createdBy,
      expectedPkr: 0,
      receipts: [],
      since: businessDate(r.createdAt),
    };
    entry.expectedPkr = round2(entry.expectedPkr + Number(r.amountPkr) - Number(r.taxWithheldPkr));
    entry.receipts.push({ id: r.id });
    byCollector.set(r.createdBy, entry);
  }
  return byCollector;
}

export class CashHandoverService {
  constructor(
    private prisma: PrismaClient,
    private journal: JournalEntryService,
  ) {}

  /**
   * The desk's day: per collector, trucks dispatched, money taken by method, credit billed, and the
   * cash still waiting to be handed over. `seeAll` is a manager's view; everyone else sees their own row.
   */
  async day(facilityId: string, userId: string, seeAll: boolean, dateIso?: string) {
    const date = dateIso ?? businessDate();
    const from = businessDayStart(date);
    const to = businessDayStart(addDays(date, 1));
    const own = seeAll ? {} : { createdBy: userId };

    const [dispatched, payments, invoices, from0] = await Promise.all([
      this.prisma.outboundEvent.groupBy({
        by: ['finalizedBy'],
        where: {
          facilityId,
          status: 'DISPATCHED',
          finalizedAt: { gte: from, lt: to },
          finalizedBy: seeAll ? { not: null } : userId,
        },
        _count: { _all: true },
      }),
      this.prisma.payment.findMany({
        where: { facilityId, createdAt: { gte: from, lt: to }, clearanceStatus: { not: 'BOUNCED' }, ...own },
        select: { createdBy: true, paymentMethod: true, amountPkr: true, taxWithheldPkr: true },
      }),
      this.prisma.invoice.findMany({
        where: {
          facilityId,
          finalizedAt: { gte: from, lt: to },
          status: { in: ['FINALIZED', 'WRITTEN_OFF'] },
          finalizedBy: seeAll ? { not: null } : userId,
        },
        select: {
          finalizedBy: true,
          totalPkr: true,
          allocations: {
            where: { voidedAt: null, payment: { clearanceStatus: { not: 'BOUNCED' } } },
            select: { allocatedAmountPkr: true, payment: { select: { createdBy: true, createdAt: true } } },
          },
        },
      }),
      trackingFrom(this.prisma, facilityId),
    ]);

    type Row = {
      user_id: string;
      dispatched: number;
      cash_collected_pkr: number;
      other_collected_pkr: number;
      cheques_count: number;
      cheques_pkr: number;
      credit_billed_pkr: number;
      pending_cash_pkr: number | null;
      pending_receipts: number;
      pending_since: string | null;
    };
    const rows = new Map<string, Row>();
    const row = (id: string): Row => {
      let r = rows.get(id);
      if (!r) {
        r = {
          user_id: id,
          dispatched: 0,
          cash_collected_pkr: 0,
          other_collected_pkr: 0,
          cheques_count: 0,
          cheques_pkr: 0,
          credit_billed_pkr: 0,
          pending_cash_pkr: from0 ? 0 : null,
          pending_receipts: 0,
          pending_since: null,
        };
        rows.set(id, r);
      }
      return r;
    };
    row(userId); // your own row is always there, even on a quiet day

    for (const d of dispatched) if (d.finalizedBy) row(d.finalizedBy).dispatched = d._count._all;
    for (const p of payments) {
      const r = row(p.createdBy);
      const net = Number(p.amountPkr) - Number(p.taxWithheldPkr);
      if (p.paymentMethod === 'CASH') r.cash_collected_pkr += net;
      else if (p.paymentMethod === 'CHEQUE') {
        r.cheques_count += 1;
        r.cheques_pkr += net;
      } else r.other_collected_pkr += net;
    }
    for (const inv of invoices) {
      // Credit billed: what the collector's own receipts of the day did not cover.
      const paid = inv.allocations
        .filter((a) => a.payment.createdBy === inv.finalizedBy && a.payment.createdAt >= from && a.payment.createdAt < to)
        .reduce((s, a) => s + Number(a.allocatedAmountPkr), 0);
      row(inv.finalizedBy!).credit_billed_pkr += Math.max(0, Number(inv.totalPkr) - paid);
    }

    if (from0) {
      const pool = await pendingCash(this.prisma, facilityId, from0);
      for (const [collectorId, p] of pool) {
        if (!seeAll && collectorId !== userId) continue;
        const r = row(collectorId);
        r.pending_cash_pkr = p.expectedPkr;
        r.pending_receipts = p.receipts.length;
        r.pending_since = p.since;
      }
    }

    const users = await this.prisma.user.findMany({
      where: { facilityId, id: { in: [...rows.keys()] } },
      select: { id: true, name: true, role: true },
    });
    const who = new Map(users.map((u) => [u.id, u]));
    const data = [...rows.values()]
      .map((r) => ({
        ...r,
        user_name: who.get(r.user_id)?.name ?? '—',
        role: who.get(r.user_id)?.role ?? null,
        cash_collected_pkr: round2(r.cash_collected_pkr),
        other_collected_pkr: round2(r.other_collected_pkr),
        cheques_pkr: round2(r.cheques_pkr),
        credit_billed_pkr: round2(r.credit_billed_pkr),
      }))
      .filter((r) => r.user_id === userId || r.dispatched > 0 || r.cash_collected_pkr > 0 || r.other_collected_pkr > 0 || r.cheques_count > 0 || r.credit_billed_pkr > 0 || r.pending_receipts > 0)
      .sort((a, b) => Number(b.user_id === userId) - Number(a.user_id === userId) || a.user_name.localeCompare(b.user_name));

    return { date, tracking: from0 != null, tracking_from: from0, can_count: seeAll, rows: data };
  }

  /**
   * A manager counts a collector's waiting cash. The figure they were shown is echoed back: if the pool
   * moved since (a truck was paid meanwhile) it is refused with the new figure rather than booking a
   * difference that is not one. The collector is the receipts' own recorder, never taken from trust, and
   * nobody counts their own cash. A difference posts JE-28 in the same transaction.
   */
  async create(facilityId: string, userId: string, body: CreateCashHandoverRequestType) {
    const from = await trackingFrom(this.prisma, facilityId);
    if (!from) throw Errors.CASH_TRACKING_OFF();
    if (body.collector_id === userId) throw Errors.HANDOVER_SELF_CONFIRM();
    const today = businessDate();

    return this.prisma.$transaction(async (tx) => {
      // One handover at a time per collector; UNIQUE(payment_id) is the backstop.
      await advisoryXactLock(tx, `${facilityId}:cash-handover:${body.collector_id}`);
      const collector = await tx.user.findFirst({
        where: { id: body.collector_id, facilityId },
        select: { id: true, name: true },
      });
      if (!collector) throw Errors.USER_NOT_FOUND();

      const pool = (await pendingCash(tx, facilityId, from, collector.id)).get(collector.id);
      if (!pool || pool.receipts.length === 0) throw Errors.HANDOVER_NOTHING_PENDING();
      if (Math.abs(pool.expectedPkr - body.expected_cash_pkr) > 0.005) {
        throw Errors.HANDOVER_EXPECTED_CHANGED(body.expected_cash_pkr, pool.expectedPkr);
      }

      const counted = round2(body.counted_cash_pkr);
      const variance = round2(counted - pool.expectedPkr);
      const reason = body.variance_reason?.trim() || null;
      if (variance !== 0 && (!reason || reason.length < 3)) {
        throw Errors.VALIDATION_ERROR('Say why the count differs from the receipts', 'variance_reason');
      }

      const handoverNumber = await nextDocumentNumber(tx, facilityId, 'cash_handovers', documentNumberPrefix('CHO', fromIsoDate(today), 'monthly'), 4);
      const handover = await tx.cashHandover.create({
        data: {
          facilityId,
          handoverNumber,
          businessDate: fromIsoDate(today),
          collectorId: collector.id,
          confirmedBy: userId,
          expectedCashPkr: pool.expectedPkr,
          countedCashPkr: counted,
          variancePkr: variance,
          varianceReason: variance !== 0 ? reason : null,
        },
      });
      await tx.cashHandoverPayment.createMany({
        data: pool.receipts.map((r) => ({ handoverId: handover.id, paymentId: r.id })),
      });

      if (variance !== 0) {
        const posted = await this.journal.postInTransaction(
          tx,
          facilityId,
          userId,
          buildJE28CashVariance({
            handoverId: handover.id,
            handoverNumber,
            entryDate: fromIsoDate(today),
            variancePkr: variance,
            collectorName: collector.name,
          }),
        );
        await tx.cashHandover.update({ where: { id: handover.id }, data: { journalEntryId: posted.id } });
      }
      return this.get(tx, facilityId, handover.id);
    });
  }

  /** Void a handover recorded in error: reverse its difference entry, free its receipts, keep the row. */
  async void(facilityId: string, userId: string, id: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      if (!(await lockRow(tx, 'cash_handovers', id, facilityId))) throw Errors.HANDOVER_NOT_FOUND();
      const handover = await tx.cashHandover.findFirstOrThrow({ where: { id, facilityId } });
      if (handover.voidedAt) throw Errors.HANDOVER_ALREADY_VOIDED();
      // Voiding reverses a shortage booked against the collector: never theirs to undo.
      if (handover.collectorId === userId) throw Errors.HANDOVER_SELF_VOID();
      if (handover.journalEntryId) {
        await this.journal.reverseInTransaction(tx, facilityId, userId, handover.journalEntryId, {
          reason: `cash handover voided — ${reason}`,
          // Dated the facility day it happened (the reversal's own default since v0.8.0, stated here anyway).
          date: fromIsoDate(businessDate()),
        });
      }
      await tx.cashHandoverPayment.deleteMany({ where: { handoverId: id } });
      await tx.cashHandover.update({ where: { id }, data: { voidedAt: new Date(), voidedBy: userId, voidReason: reason } });
      return this.get(tx, facilityId, id);
    });
  }

  async list(facilityId: string, query: CashHandoverListQueryType) {
    const where: Prisma.CashHandoverWhereInput = {
      facilityId,
      ...(query.collector_id ? { collectorId: query.collector_id } : {}),
      ...(query.has_variance === undefined ? {} : query.has_variance ? { NOT: { variancePkr: 0 } } : { variancePkr: 0 }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.cashHandover.findMany({
        where,
        include: { journalEntry: { select: { entryNumber: true } }, _count: { select: { payments: true } } },
        orderBy: [{ createdAt: 'desc' }],
        skip: (query.page - 1) * query.page_size,
        take: query.page_size,
      }),
      this.prisma.cashHandover.count({ where }),
    ]);
    const names = await this.names(this.prisma, facilityId, rows.flatMap((r) => [r.collectorId, r.confirmedBy]));
    return {
      data: rows.map((r) => format(r, names)),
      meta: { total, page: query.page, per_page: query.page_size },
    };
  }

  private async get(db: Db, facilityId: string, id: string) {
    const row = await db.cashHandover.findFirstOrThrow({
      where: { id, facilityId },
      include: { journalEntry: { select: { entryNumber: true } }, _count: { select: { payments: true } } },
    });
    return format(row, await this.names(db, facilityId, [row.collectorId, row.confirmedBy]));
  }

  private async names(db: Db, facilityId: string, ids: string[]) {
    const users = await db.user.findMany({ where: { facilityId, id: { in: [...new Set(ids)] } }, select: { id: true, name: true } });
    return new Map(users.map((u) => [u.id, u.name]));
  }
}

function format(
  r: Prisma.CashHandoverGetPayload<{ include: { journalEntry: { select: { entryNumber: true } }; _count: { select: { payments: true } } } }>,
  names: Map<string, string>,
) {
  return {
    id: r.id,
    handover_number: r.handoverNumber,
    business_date: toIsoDate(r.businessDate),
    collector_id: r.collectorId,
    collector_name: names.get(r.collectorId) ?? '—',
    confirmed_by: r.confirmedBy,
    confirmed_by_name: names.get(r.confirmedBy) ?? '—',
    expected_cash_pkr: Number(r.expectedCashPkr),
    counted_cash_pkr: Number(r.countedCashPkr),
    variance_pkr: Number(r.variancePkr),
    variance_reason: r.varianceReason,
    receipts: r._count.payments,
    journal_entry_id: r.journalEntryId,
    entry_number: r.journalEntry ? postedEntryNumber(r.journalEntry) : null,
    voided_at: r.voidedAt?.toISOString() ?? null,
    void_reason: r.voidReason,
    created_at: r.createdAt.toISOString(),
  };
}
