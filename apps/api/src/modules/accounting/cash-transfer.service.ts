import type { PrismaClient, Prisma } from '@coldchain/db';
import {
  round2,
  toIsoDate,
  type CashTransferActionType,
  type CashTransferListQueryType,
  type CreateCashTransferRequestType,
  type VoidDocumentRequestType,
} from '@coldchain/shared';
import { AppError, Errors } from '../../common/errors';
import { lockRow } from '../../common/row-lock';
import { assertKatchiWriteAllowed } from './book-gate';
import { assertCashAccount } from './cash-account';
import type { JournalEntryService } from './journal-entry.service';
import { postedEntryNumber } from './journal-entry.service';
import { buildJE27CashTransfer } from './templates/je-27-cash-transfer';

const NOT_FOUND = () => new AppError('CASH_TRANSFER_NOT_FOUND', 'Cash transfer does not exist', 404);
const ALREADY_VOIDED = () => new AppError('CASH_TRANSFER_ALREADY_VOIDED', 'This transfer has already been voided', 409);

const include = {
  fromAccount: { select: { accountName: true } },
  toAccount: { select: { accountName: true } },
  journalEntry: { select: { entryNumber: true } },
} satisfies Prisma.CashTransferInclude;

type Row = Prisma.CashTransferGetPayload<{ include: typeof include }>;

/**
 * Money moved between two of the facility's own cash equivalents (docs/25 C-44): a
 * document with a history and a void, rather than a bare JE-27 posted from a
 * controller with the acting user's id standing in as its source.
 */
export class CashTransferService {
  constructor(
    private prisma: PrismaClient,
    private journal: JournalEntryService,
  ) {}

  async create(facilityId: string, userId: string, role: string, body: CreateCashTransferRequestType) {
    assertKatchiWriteAllowed(role, body.book_type);
    if (body.from_account_code === body.to_account_code) {
      throw Errors.VALIDATION_ERROR('The source and destination must be different accounts.', 'to_account_code');
    }
    const transferDate = new Date(`${body.transfer_date}T00:00:00.000Z`);

    return this.prisma.$transaction(async (tx) => {
      await assertCashAccount(tx, facilityId, body.from_account_code);
      await assertCashAccount(tx, facilityId, body.to_account_code);

      const transfer = await tx.cashTransfer.create({
        data: {
          facilityId,
          transferDate,
          fromAccountCode: body.from_account_code,
          toAccountCode: body.to_account_code,
          amountPkr: round2(body.amount_pkr),
          notes: body.note?.trim() || null,
          bookType: body.book_type,
          createdBy: userId,
        },
        include,
      });

      const posted = await this.journal.postInTransaction(
        tx,
        facilityId,
        userId,
        buildJE27CashTransfer({
          transferId: transfer.id,
          transferDate,
          amountPkr: Number(transfer.amountPkr),
          from: { code: transfer.fromAccountCode, name: transfer.fromAccount.accountName },
          to: { code: transfer.toAccountCode, name: transfer.toAccount.accountName },
          bookType: transfer.bookType,
          note: transfer.notes,
        }),
      );

      const saved = await tx.cashTransfer.update({
        where: { id: transfer.id },
        data: { journalEntryId: posted.id },
        include,
      });
      return format(saved);
    });
  }

  async list(facilityId: string, book: 'PACCI' | 'KATCHI', query: CashTransferListQueryType) {
    const where: Prisma.CashTransferWhereInput = {
      facilityId,
      bookType: book,
      ...(query.date_from || query.date_to
        ? {
            transferDate: {
              ...(query.date_from ? { gte: new Date(query.date_from) } : {}),
              ...(query.date_to ? { lte: new Date(query.date_to) } : {}),
            },
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.cashTransfer.findMany({
        where,
        include,
        orderBy: [{ transferDate: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.page_size,
        take: query.page_size,
      }),
      this.prisma.cashTransfer.count({ where }),
    ]);
    return { data: rows.map(format), meta: { total, page: query.page, per_page: query.page_size } };
  }

  /**
   * Void a transfer recorded in error: reverse its entry and keep the row. The lock
   * comes first, and the book check runs on the locked row (docs/25 C-42).
   */
  async void(facilityId: string, userId: string, role: string, id: string, body: VoidDocumentRequestType) {
    return this.prisma.$transaction(async (tx) => {
      if (!(await lockRow(tx, 'cash_transfers', id, facilityId))) throw NOT_FOUND();
      const transfer = await tx.cashTransfer.findFirstOrThrow({ where: { id, facilityId } });
      assertKatchiWriteAllowed(role, transfer.bookType);
      if (transfer.voidedAt) throw ALREADY_VOIDED();
      if (!transfer.journalEntryId) throw new Error(`Cash transfer ${id} has no journal entry`);

      await this.journal.reverseInTransaction(tx, facilityId, userId, transfer.journalEntryId, {
        reason: `cash transfer voided — ${body.reason}`,
        date: body.void_date ? new Date(`${body.void_date}T00:00:00.000Z`) : undefined,
      });

      const saved = await tx.cashTransfer.update({
        where: { id },
        data: { voidedAt: new Date(), voidedBy: userId, voidReason: body.reason },
        include,
      });
      return format(saved);
    });
  }
}

function allowedActions(t: { voidedAt: Date | null }): CashTransferActionType[] {
  return t.voidedAt ? [] : ['void'];
}

function format(t: Row) {
  return {
    id: t.id,
    transfer_date: toIsoDate(t.transferDate),
    from_account_code: t.fromAccountCode,
    from_account_name: t.fromAccount.accountName,
    to_account_code: t.toAccountCode,
    to_account_name: t.toAccount.accountName,
    amount_pkr: Number(t.amountPkr),
    notes: t.notes,
    book_type: t.bookType,
    journal_entry_id: t.journalEntryId,
    entry_number: t.journalEntry ? postedEntryNumber(t.journalEntry) : null,
    voided_at: t.voidedAt?.toISOString() ?? null,
    void_reason: t.voidReason,
    allowed_actions: allowedActions(t),
    created_at: t.createdAt.toISOString(),
  };
}
