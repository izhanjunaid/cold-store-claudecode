import type { Prisma, PrismaClient } from '@coldchain/db';
import {
  fromIsoDate,
  toIsoDate,
  type CreateOwnerEquityRequestType,
  type OwnerEquityListQueryType,
  type VoidOwnerEquityRequestType,
} from '@coldchain/shared';
import { Errors } from '../../common/errors';
import { lockRow } from '../../common/row-lock';
import { JournalEntryService, postedEntryNumber } from '../accounting/journal-entry.service';
import { PeriodLockService } from '../accounting/period-lock.service';
import { buildJE30OwnerEquity } from '../accounting/templates/je-30-owner-equity';

const include = {
  partner: { select: { name: true, capitalAccountCode: true, drawingsAccountCode: true } },
  journalEntry: { select: { entryNumber: true } },
} satisfies Prisma.OwnerEquityMovementInclude;

type Row = Prisma.OwnerEquityMovementGetPayload<{ include: typeof include }>;

function format(m: Row) {
  return {
    id: m.id,
    partner_id: m.partnerId,
    partner_name: m.partner.name,
    direction: m.direction,
    movement_date: toIsoDate(m.movementDate),
    amount_pkr: Number(m.amountPkr),
    cash_account_code: m.cashAccountCode,
    equity_account_code: m.direction === 'CAPITAL_IN' ? m.partner.capitalAccountCode : m.partner.drawingsAccountCode,
    note: m.note,
    book_type: m.bookType,
    journal_entry_id: m.journalEntryId,
    entry_number: m.journalEntry?.entryNumber ?? null,
    voided_at: m.voidedAt?.toISOString() ?? null,
    void_reason: m.voidReason,
  };
}

/**
 * An owner putting money in or taking it out, as a document (docs/25 L-23, C-44).
 *
 * It used to be a route that posted a bare journal entry sourced to the acting
 * user, with the equity account chosen separately from the direction — so a
 * "capital in" could credit a drawings account, a drawing could debit the plug,
 * and nothing could be voided. Now the request names the partner; the account is
 * theirs, by direction; the cash side must be flagged cash; and a mistake is
 * voided through its own reversal.
 */
export class OwnerEquityService {
  private journalEntry: JournalEntryService;

  constructor(private prisma: PrismaClient) {
    this.journalEntry = new JournalEntryService(prisma, new PeriodLockService(prisma));
  }

  async list(facilityId: string, query: OwnerEquityListQueryType) {
    const rows = await this.prisma.ownerEquityMovement.findMany({
      where: { facilityId, ...(query.partner_id ? { partnerId: query.partner_id } : {}) },
      include,
      orderBy: [{ movementDate: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map(format);
  }

  async create(facilityId: string, userId: string, body: CreateOwnerEquityRequestType) {
    return this.prisma.$transaction(async (tx) => {
      const partner = await tx.partner.findFirst({ where: { id: body.partner_id, facilityId } });
      if (!partner) throw Errors.PARTNER_NOT_FOUND();
      if (body.movement_date < toIsoDate(partner.admittedOn)) {
        throw Errors.VALIDATION_ERROR(
          `${partner.name} was admitted on ${toIsoDate(partner.admittedOn)}; a movement cannot be dated before that`,
          'movement_date',
        );
      }

      const cash = await tx.chartOfAccounts.findUnique({
        where: { facilityId_accountCode: { facilityId, accountCode: body.cash_account_code } },
      });
      if (!cash || !cash.isActive || !cash.isCashEquivalent) {
        throw Errors.VALIDATION_ERROR(
          'Money must move to or from a cash, bank or wallet account — one the chart of accounts marks as cash',
          'cash_account_code',
        );
      }

      const equityAccountCode = body.direction === 'CAPITAL_IN' ? partner.capitalAccountCode : partner.drawingsAccountCode;
      const movement = await tx.ownerEquityMovement.create({
        data: {
          facilityId,
          partnerId: partner.id,
          direction: body.direction,
          movementDate: fromIsoDate(body.movement_date),
          amountPkr: body.amount_pkr,
          cashAccountCode: cash.accountCode,
          note: body.note?.trim() || null,
          bookType: body.book_type,
          createdBy: userId,
        },
      });
      const posted = await this.journalEntry.postInTransaction(
        tx,
        facilityId,
        userId,
        buildJE30OwnerEquity({
          movementId: movement.id,
          movementDate: movement.movementDate,
          amountPkr: body.amount_pkr,
          direction: body.direction,
          partnerName: partner.name,
          equityAccountCode,
          cashAccountCode: cash.accountCode,
          bookType: body.book_type,
          note: body.note,
        }),
      );
      await tx.ownerEquityMovement.update({ where: { id: movement.id }, data: { journalEntryId: posted.id } });
      return { movementId: movement.id, journalEntryId: posted.id };
    });
  }

  /**
   * Void a movement: lock it, reverse its entry (the only mirror builder), and
   * stamp the cancellation on the document. Two voids at once cannot both pass —
   * the second waits on the row lock and then finds it already voided.
   */
  async void(facilityId: string, userId: string, id: string, body: VoidOwnerEquityRequestType) {
    return this.prisma.$transaction(async (tx) => {
      if (!(await lockRow(tx, 'owner_equity_movements', id, facilityId))) {
        throw Errors.VALIDATION_ERROR('Owner movement not found', 'id');
      }
      const movement = await tx.ownerEquityMovement.findUniqueOrThrow({ where: { id } });
      if (movement.voidedAt) throw Errors.VALIDATION_ERROR('This movement is already voided', 'id');
      if (!movement.journalEntryId) throw Errors.VALIDATION_ERROR('This movement has no posted entry to reverse', 'id');

      const reversal = await this.journalEntry.reverseInTransaction(tx, facilityId, userId, movement.journalEntryId, {
        reason: body.reason,
        date: body.date ? fromIsoDate(body.date) : undefined,
      });
      await tx.ownerEquityMovement.update({
        where: { id },
        data: { voidedAt: new Date(), voidedBy: userId, voidReason: body.reason },
      });
      const row = await tx.ownerEquityMovement.findUniqueOrThrow({ where: { id }, include });
      return { ...format(row), reversal_entry_number: postedEntryNumber(reversal) };
    });
  }
}
