import type { PrismaClient, Prisma } from '@coldchain/db';
import { Errors } from '../../common/errors';
import { generateJournalEntryNumber } from './journal-entry-number';
import { derivePeriod } from './period';
import type { JournalEntryDraft } from './templates/types';
import { PeriodLockService } from './period-lock.service';

type Tx = Prisma.TransactionClient;

export type PostedJournalEntry = {
  id: string;
  entryNumber: string;
  entryDate: Date;
  postingStatus: 'AUTO_DRAFT' | 'POSTED' | 'REVERSED';
  totalDebit: number;
  totalCredit: number;
};

export class JournalEntryService {
  constructor(
    private prisma: PrismaClient,
    private periodLock: PeriodLockService,
  ) {}

  /**
   * Post a balanced journal entry inside an existing transaction. Throws
   * - JOURNAL_UNBALANCED if SUM(debit) != SUM(credit)
   * - PERIOD_LOCKED if the entry_date falls in a locked period
   * - ACCOUNT_NOT_FOUND if any line references an unknown account
   * - HEADER_ACCOUNT_NOT_POSTABLE if any line targets a HEADER account
   * - ACCOUNT_INACTIVE if any account is is_active = false
   */
  async postInTransaction(
    tx: Tx,
    facilityId: string,
    createdBy: string,
    draft: JournalEntryDraft,
    options?: { postingStatus?: 'AUTO_DRAFT' | 'POSTED'; reversedById?: string | null },
  ): Promise<PostedJournalEntry> {
    if (draft.lines.length < 2) {
      throw Errors.VALIDATION_ERROR('Journal entry must have at least 2 lines');
    }

    let totalDebit = 0;
    let totalCredit = 0;
    for (const line of draft.lines) {
      const d = roundCents(Number(line.debitAmount ?? 0));
      const c = roundCents(Number(line.creditAmount ?? 0));
      if (d < 0 || c < 0) {
        throw Errors.VALIDATION_ERROR('Debit/credit amounts must be non-negative');
      }
      if (d > 0 && c > 0) {
        throw Errors.VALIDATION_ERROR('A line cannot have both debit and credit amounts');
      }
      if (d === 0 && c === 0) {
        throw Errors.VALIDATION_ERROR('A line must have either a debit or credit amount');
      }
      totalDebit += d;
      totalCredit += c;
    }
    totalDebit = roundCents(totalDebit);
    totalCredit = roundCents(totalCredit);
    if (Math.abs(totalDebit - totalCredit) > 0.005) {
      throw Errors.JOURNAL_UNBALANCED();
    }

    await this.periodLock.assertOpen(tx, facilityId, draft.entryDate);

    await validatePostableAccounts(tx, facilityId, draft.lines.map((l) => l.accountCode));

    const entryNumber = await generateJournalEntryNumber(tx, facilityId, draft.entryDate);

    const created = await tx.journalEntry.create({
      data: {
        facilityId,
        entryNumber,
        entryDate: draft.entryDate,
        entryType: draft.entryType,
        bookType: draft.bookType,
        sourceTable: draft.sourceTable,
        sourceId: draft.sourceId,
        description: draft.description,
        postingStatus: options?.postingStatus ?? 'POSTED',
        periodMonth: derivePeriod(draft.entryDate).month,
        periodYear: derivePeriod(draft.entryDate).year,
        reversedById: options?.reversedById ?? null,
        createdBy,
        lines: {
          create: draft.lines.map((l, idx) => ({
            lineNumber: idx + 1,
            accountCode: l.accountCode,
            facilityId,
            debitAmount: roundCents(Number(l.debitAmount ?? 0)),
            creditAmount: roundCents(Number(l.creditAmount ?? 0)),
            partyId: l.partyId ?? null,
            lotId: l.lotId ?? null,
            description: l.description ?? null,
          })),
        },
      },
    });

    return {
      id: created.id,
      entryNumber: created.entryNumber,
      entryDate: created.entryDate,
      postingStatus: created.postingStatus as PostedJournalEntry['postingStatus'],
      totalDebit,
      totalCredit,
    };
  }

  /**
   * Convenience wrapper that opens its own transaction. Use this from controllers; from services
   * already inside a transaction, call postInTransaction(tx, ...) directly.
   */
  async post(
    facilityId: string,
    createdBy: string,
    draft: JournalEntryDraft,
    options?: { postingStatus?: 'AUTO_DRAFT' | 'POSTED'; reversedById?: string | null },
  ): Promise<PostedJournalEntry> {
    return this.prisma.$transaction((tx) =>
      this.postInTransaction(tx, facilityId, createdBy, draft, options),
    );
  }

  /**
   * Promote an AUTO_DRAFT entry to POSTED (audit finding F-7 — drafts
   * previously had no path into the books). Re-runs the period-lock and
   * account checks: both may have changed since the draft was saved.
   */
  async postDraft(facilityId: string, id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const entry = await tx.journalEntry.findFirst({
        where: { id, facilityId },
        include: { lines: { select: { accountCode: true } } },
      });
      if (!entry) throw Errors.VALIDATION_ERROR('Journal entry not found', 'id');
      if (entry.postingStatus !== 'AUTO_DRAFT') throw Errors.JOURNAL_ENTRY_NOT_DRAFT();

      await this.periodLock.assertOpen(tx, facilityId, entry.entryDate);
      await validatePostableAccounts(tx, facilityId, entry.lines.map((l) => l.accountCode));

      await tx.journalEntry.update({
        where: { id: entry.id },
        data: { postingStatus: 'POSTED' },
      });
    });
  }

  /**
   * Reverse a posted manual journal entry (audit Gap 2): builds the
   * mirror-image entry, links both ways, and flips the original to REVERSED.
   * System-generated entries are rejected — reversing them behind their
   * source document's back would split the GL from the subledgers; they are
   * corrected through their own flows (credit note, dishonour, write-off).
   */
  async reverse(
    facilityId: string,
    userId: string,
    id: string,
    reason: string,
    entryDate?: Date,
  ): Promise<PostedJournalEntry> {
    return this.prisma.$transaction(async (tx) => {
      const entry = await tx.journalEntry.findFirst({
        where: { id, facilityId },
        include: { lines: { orderBy: { lineNumber: 'asc' } } },
      });
      if (!entry) throw Errors.VALIDATION_ERROR('Journal entry not found', 'id');
      if (entry.sourceTable !== 'manual' && entry.sourceTable !== 'opening_balances') {
        throw Errors.JOURNAL_ENTRY_NOT_REVERSIBLE();
      }
      if (entry.postingStatus === 'REVERSED') throw Errors.JOURNAL_ENTRY_ALREADY_REVERSED();
      if (entry.postingStatus !== 'POSTED') throw Errors.JOURNAL_ENTRY_NOT_POSTED();

      const reversal = await this.postInTransaction(tx, facilityId, userId, {
        entryType: 'REVERSAL',
        bookType: entry.bookType,
        sourceTable: 'journal_entries',
        sourceId: entry.id,
        entryDate: entryDate ?? new Date(),
        description: `Reversal of ${entry.entryNumber} — ${reason}`,
        lines: entry.lines.map((l) => ({
          accountCode: l.accountCode,
          debitAmount: Number(l.creditAmount),
          creditAmount: Number(l.debitAmount),
          partyId: l.partyId,
          lotId: l.lotId,
          description: l.description,
        })),
      });

      await this.markReversed(tx, entry.id, reversal.id);
      return reversal;
    });
  }

  /**
   * Mark an existing journal entry as REVERSED and link it to the reversing entry.
   * Used by the dishonour flow (JE-06 reverses JE-02).
   */
  async markReversed(tx: Tx, originalId: string, reversingEntryId: string): Promise<void> {
    await tx.journalEntry.update({
      where: { id: originalId },
      data: {
        postingStatus: 'REVERSED',
        reversedById: reversingEntryId,
      },
    });
  }

  async getById(facilityId: string, id: string) {
    const entry = await this.prisma.journalEntry.findFirst({
      where: { id, facilityId },
      include: {
        createdByUser: { select: { name: true } },
        reversedBy: { select: { entryNumber: true } },
        lines: {
          orderBy: { lineNumber: 'asc' },
          include: {
            account: { select: { accountName: true } },
            party: { select: { name: true } },
            lot: { select: { lotNumber: true } },
          },
        },
      },
    });
    if (!entry) throw Errors.VALIDATION_ERROR('Journal entry not found', 'id');
    return formatEntry(entry);
  }

  async list(
    facilityId: string,
    query: {
      entryType?: string;
      bookType?: string;
      sourceTable?: string;
      sourceId?: string;
      dateFrom?: string;
      dateTo?: string;
      postingStatus?: string;
      page: number;
      pageSize: number;
    },
  ) {
    const where: Prisma.JournalEntryWhereInput = { facilityId };
    if (query.entryType) where.entryType = query.entryType as any;
    if (query.bookType) where.bookType = query.bookType as any;
    if (query.sourceTable) where.sourceTable = query.sourceTable;
    if (query.sourceId) where.sourceId = query.sourceId;
    if (query.postingStatus) where.postingStatus = query.postingStatus as any;
    if (query.dateFrom || query.dateTo) {
      where.entryDate = {};
      if (query.dateFrom) (where.entryDate as any).gte = new Date(query.dateFrom);
      if (query.dateTo) (where.entryDate as any).lte = new Date(query.dateTo);
    }

    const [data, total] = await Promise.all([
      this.prisma.journalEntry.findMany({
        where,
        include: {
          createdByUser: { select: { name: true } },
          reversedBy: { select: { entryNumber: true } },
          lines: {
            orderBy: { lineNumber: 'asc' },
            include: {
              account: { select: { accountName: true } },
              party: { select: { name: true } },
              lot: { select: { lotNumber: true } },
            },
          },
        },
        orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.journalEntry.count({ where }),
    ]);

    return {
      data: data.map(formatEntry),
      meta: { total, page: query.page, per_page: query.pageSize },
    };
  }
}

type EntryWithRelations = Prisma.JournalEntryGetPayload<{
  include: {
    createdByUser: { select: { name: true } };
    reversedBy: { select: { entryNumber: true } };
    lines: {
      include: {
        account: { select: { accountName: true } };
        party: { select: { name: true } };
        lot: { select: { lotNumber: true } };
      };
    };
  };
}>;

function formatEntry(e: EntryWithRelations) {
  const totalDebit = e.lines.reduce((s, l) => s + Number(l.debitAmount), 0);
  const totalCredit = e.lines.reduce((s, l) => s + Number(l.creditAmount), 0);
  return {
    id: e.id,
    facility_id: e.facilityId,
    entry_number: e.entryNumber,
    entry_date: e.entryDate.toISOString().slice(0, 10),
    entry_type: e.entryType,
    book_type: e.bookType,
    source_table: e.sourceTable,
    source_id: e.sourceId,
    description: e.description,
    posting_status: e.postingStatus,
    period_month: e.periodMonth,
    period_year: e.periodYear,
    reversed_by_id: e.reversedById,
    reversed_by_entry_number: e.reversedBy?.entryNumber ?? null,
    total_debit_pkr: roundCents(totalDebit),
    total_credit_pkr: roundCents(totalCredit),
    created_at: e.createdAt.toISOString(),
    created_by_name: e.createdByUser.name,
    lines: e.lines.map((l) => ({
      id: l.id,
      line_number: l.lineNumber,
      account_code: l.accountCode,
      account_name: l.account.accountName,
      debit_amount: Number(l.debitAmount),
      credit_amount: Number(l.creditAmount),
      party_id: l.partyId,
      party_name: l.party?.name ?? null,
      lot_id: l.lotId,
      lot_number: l.lot?.lotNumber ?? null,
      description: l.description,
    })),
  };
}

function roundCents(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Every referenced account must exist, be active, and not be a HEADER. */
async function validatePostableAccounts(tx: Tx, facilityId: string, accountCodes: string[]): Promise<void> {
  const codes = Array.from(new Set(accountCodes));
  const accounts = await tx.chartOfAccounts.findMany({
    where: { facilityId, accountCode: { in: codes } },
  });
  const found = new Set(accounts.map((a) => a.accountCode));
  for (const code of codes) {
    if (!found.has(code)) throw Errors.ACCOUNT_NOT_FOUND();
  }
  for (const a of accounts) {
    if (!a.isActive) throw Errors.ACCOUNT_INACTIVE();
    if (a.accountType === 'HEADER') throw Errors.HEADER_ACCOUNT_NOT_POSTABLE();
  }
}
