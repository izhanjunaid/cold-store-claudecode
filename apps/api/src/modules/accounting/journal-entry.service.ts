import type { PrismaClient, Prisma } from '@coldchain/db';
import {
  SYSTEM_ACCOUNTS,
  isUserReversibleSource,
  periodOf,
  round2,
  toIsoDate,
  MONEY_EPSILON,
} from '@coldchain/shared';
import { Errors } from '../../common/errors';
import { generateJournalEntryNumber } from './journal-entry-number';
import type { JournalEntryDraft } from './templates/types';
import { PeriodLockService } from './period-lock.service';

type Tx = Prisma.TransactionClient;

export type PostedJournalEntry = {
  id: string;
  /** Null only for a draft; assigned when the entry is posted. */
  entryNumber: string | null;
  entryDate: Date;
  postingStatus: 'AUTO_DRAFT' | 'POSTED';
  totalDebit: number;
  totalCredit: number;
};

/**
 * The number of an entry that has been posted. A posted entry always has one
 * (CHECK journal_entries_posted_has_number); a draft never does.
 */
export function postedEntryNumber(entry: { entryNumber: string | null; id?: string }): string {
  if (entry.entryNumber === null) {
    throw new Error(`Journal entry ${entry.id ?? ''} is a draft and has no number`);
  }
  return entry.entryNumber;
}

export class JournalEntryService {
  constructor(
    private prisma: PrismaClient,
    private periodLock: PeriodLockService,
  ) {}

  /**
   * Post a balanced journal entry inside an existing transaction — the only way a
   * journal row is written (CI gate). Throws
   * - VALIDATION_ERROR for malformed lines, a line missing the party its account
   *   requires, or a manual line on an account no person may post to
   * - JOURNAL_UNBALANCED if SUM(debit) != SUM(credit)
   * - PERIOD_LOCKED if the entry_date falls in a locked period
   * - ACCOUNT_NOT_FOUND / ACCOUNT_INACTIVE / HEADER_ACCOUNT_NOT_POSTABLE
   *
   * A draft (AUTO_DRAFT) is saved without a number; it takes one when posted.
   */
  async postInTransaction(
    tx: Tx,
    facilityId: string,
    createdBy: string,
    draft: JournalEntryDraft,
    options?: { postingStatus?: 'AUTO_DRAFT' | 'POSTED' },
  ): Promise<PostedJournalEntry> {
    return this.insert(tx, facilityId, createdBy, draft, options?.postingStatus ?? 'POSTED', false);
  }

  /** Convenience wrapper that opens its own transaction. */
  async post(
    facilityId: string,
    createdBy: string,
    draft: JournalEntryDraft,
    options?: { postingStatus?: 'AUTO_DRAFT' | 'POSTED' },
  ): Promise<PostedJournalEntry> {
    return this.prisma.$transaction((tx) => this.postInTransaction(tx, facilityId, createdBy, draft, options));
  }

  /**
   * Reverse a posted entry: post its mirror image and record the link on the
   * original — the ONLY place a mirror is built or a reversal linked.
   *
   * The original stays POSTED in its own period; the mirror is dated when the
   * reversal happened (migration 0025). The mirror inherits the original's source,
   * so "the entries for this document" includes their reversals. It bypasses the
   * manual-posting rules — history must stay reversible even on an account nobody
   * may post to by hand today — but not the period lock, and it may not be dated
   * before the entry it reverses.
   */
  async reverseInTransaction(
    tx: Tx,
    facilityId: string,
    userId: string,
    originalId: string,
    opts: { reason: string; date?: Date },
  ): Promise<PostedJournalEntry> {
    const original = await tx.journalEntry.findFirst({
      where: { id: originalId, facilityId },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });
    if (!original) throw Errors.VALIDATION_ERROR('Journal entry not found', 'id');
    if (original.postingStatus !== 'POSTED') throw Errors.JOURNAL_ENTRY_NOT_POSTED();
    if (original.reversedById) throw Errors.JOURNAL_ENTRY_ALREADY_REVERSED();
    if (original.entryType === 'REVERSAL') {
      throw Errors.VALIDATION_ERROR('A reversal cannot itself be reversed; post the entry again instead', 'id');
    }

    const date = opts.date ?? new Date(`${toIsoDate(new Date())}T00:00:00.000Z`);
    if (toIsoDate(date) < toIsoDate(original.entryDate)) {
      throw Errors.VALIDATION_ERROR(
        `A reversal cannot be dated before the entry it reverses (${toIsoDate(original.entryDate)})`,
        'entry_date',
      );
    }

    const reversal = await this.insert(
      tx,
      facilityId,
      userId,
      {
        entryType: 'REVERSAL',
        bookType: original.bookType,
        sourceTable: original.sourceTable,
        sourceId: original.sourceId,
        entryDate: date,
        description: `Reversal of ${postedEntryNumber(original)} — ${opts.reason}`,
        lines: original.lines.map((l) => ({
          accountCode: l.accountCode,
          debitAmount: Number(l.creditAmount),
          creditAmount: Number(l.debitAmount),
          partyId: l.partyId,
          lotId: l.lotId,
          description: l.description,
        })),
      },
      'POSTED',
      true,
    );

    await tx.journalEntry.update({ where: { id: original.id }, data: { reversedById: reversal.id } });
    return reversal;
  }

  /**
   * Transitional: records `reversedById` for the one caller that still builds its
   * own reversing entry (cheque dishonour, JE-06). Stream R replaces that with a
   * chain of reverseInTransaction calls and deletes this (docs/25 R-05).
   */
  async markReversed(tx: Tx, originalId: string, reversingEntryId: string): Promise<void> {
    await tx.journalEntry.update({ where: { id: originalId }, data: { reversedById: reversingEntryId } });
  }

  /**
   * Reverse an entry a person may reverse from the journal (JOURNAL_SOURCES):
   * manual entries, opening balances and the legacy document-less transfers. Every
   * other entry is corrected through the document that posted it.
   */
  async reverse(
    facilityId: string,
    userId: string,
    id: string,
    reason: string,
    entryDate?: Date,
  ): Promise<PostedJournalEntry> {
    return this.prisma.$transaction(async (tx) => {
      const entry = await tx.journalEntry.findFirst({ where: { id, facilityId }, select: { sourceTable: true } });
      if (!entry) throw Errors.VALIDATION_ERROR('Journal entry not found', 'id');
      if (!isUserReversibleSource(entry.sourceTable)) throw Errors.JOURNAL_ENTRY_NOT_REVERSIBLE();
      return this.reverseInTransaction(tx, facilityId, userId, id, { reason, date: entryDate });
    });
  }

  /**
   * Promote a draft into the books. Re-runs every posting rule (the period may have
   * locked or an account changed since the draft was saved) and assigns the number
   * now, so an abandoned draft never consumes one.
   */
  async postDraft(facilityId: string, id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const entry = await tx.journalEntry.findFirst({
        where: { id, facilityId },
        include: { lines: true },
      });
      if (!entry) throw Errors.VALIDATION_ERROR('Journal entry not found', 'id');
      if (entry.postingStatus !== 'AUTO_DRAFT') throw Errors.JOURNAL_ENTRY_NOT_DRAFT();

      await this.checkPostingRules(tx, facilityId, {
        sourceTable: entry.sourceTable,
        entryDate: entry.entryDate,
        lines: entry.lines.map((l) => ({
          accountCode: l.accountCode,
          debitAmount: Number(l.debitAmount),
          creditAmount: Number(l.creditAmount),
          partyId: l.partyId,
        })),
      });

      await tx.journalEntry.update({
        where: { id: entry.id },
        data: {
          postingStatus: 'POSTED',
          entryNumber: await generateJournalEntryNumber(tx, facilityId, entry.entryDate),
        },
      });
    });
  }

  async getById(facilityId: string, id: string) {
    const entry = await this.prisma.journalEntry.findFirst({
      where: { id, facilityId },
      include: entryInclude,
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
      reversed?: boolean;
      page: number;
      pageSize: number;
    },
  ) {
    const where: Prisma.JournalEntryWhereInput = { facilityId };
    if (query.entryType) where.entryType = query.entryType as Prisma.JournalEntryWhereInput['entryType'];
    if (query.bookType) where.bookType = query.bookType as Prisma.JournalEntryWhereInput['bookType'];
    if (query.sourceTable) where.sourceTable = query.sourceTable;
    if (query.sourceId) where.sourceId = query.sourceId;
    if (query.postingStatus) where.postingStatus = query.postingStatus as Prisma.JournalEntryWhereInput['postingStatus'];
    if (query.reversed !== undefined) where.reversedById = query.reversed ? { not: null } : null;
    if (query.dateFrom || query.dateTo) {
      where.entryDate = {
        ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
        ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
      };
    }

    const [data, total] = await Promise.all([
      this.prisma.journalEntry.findMany({
        where,
        include: entryInclude,
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

  // ---------------------------------------------------------------------------

  private async insert(
    tx: Tx,
    facilityId: string,
    createdBy: string,
    draft: JournalEntryDraft,
    postingStatus: 'AUTO_DRAFT' | 'POSTED',
    isReversal: boolean,
  ): Promise<PostedJournalEntry> {
    if (draft.lines.length < 2) {
      throw Errors.VALIDATION_ERROR('Journal entry must have at least 2 lines');
    }

    let totalDebit = 0;
    let totalCredit = 0;
    for (const line of draft.lines) {
      const d = round2(Number(line.debitAmount ?? 0));
      const c = round2(Number(line.creditAmount ?? 0));
      if (d < 0 || c < 0) throw Errors.VALIDATION_ERROR('Debit/credit amounts must be non-negative');
      if (d > 0 && c > 0) throw Errors.VALIDATION_ERROR('A line cannot have both debit and credit amounts');
      if (d === 0 && c === 0) throw Errors.VALIDATION_ERROR('A line must have either a debit or credit amount');
      totalDebit += d;
      totalCredit += c;
    }
    totalDebit = round2(totalDebit);
    totalCredit = round2(totalCredit);
    if (Math.abs(totalDebit - totalCredit) >= MONEY_EPSILON) throw Errors.JOURNAL_UNBALANCED();

    if (isReversal) {
      await this.periodLock.assertOpen(tx, facilityId, draft.entryDate);
      await validateAccounts(tx, facilityId, draft.lines.map((l) => l.accountCode));
    } else {
      await this.checkPostingRules(tx, facilityId, draft);
    }

    const period = periodOf(draft.entryDate);
    const entryNumber =
      postingStatus === 'POSTED' ? await generateJournalEntryNumber(tx, facilityId, draft.entryDate) : null;

    const created = await tx.journalEntry.create({
      data: {
        ...(draft.id ? { id: draft.id } : {}),
        facilityId,
        entryNumber,
        entryDate: draft.entryDate,
        entryType: draft.entryType,
        bookType: draft.bookType,
        sourceTable: draft.sourceTable,
        sourceId: draft.sourceId,
        description: draft.description,
        postingStatus,
        periodMonth: period.month,
        periodYear: period.year,
        createdBy,
        lines: {
          create: draft.lines.map((l, idx) => ({
            lineNumber: idx + 1,
            accountCode: l.accountCode,
            facilityId,
            debitAmount: round2(Number(l.debitAmount ?? 0)),
            creditAmount: round2(Number(l.creditAmount ?? 0)),
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
   * The rules every new entry obeys (docs/25 §2 manual-posting matrix):
   * - the period is open; every account exists, is active and is a DETAIL
   * - no source may post the current-year result (it is computed, never posted)
   * - an account that requires a party gets one on every line
   * - a MANUAL entry may not touch an account that only its own documents or
   *   automated flow may move
   *
   * Future dates are allowed, deliberately: a post-dated journal is legitimate in
   * every mainstream ledger, and the period lock is the control that matters.
   */
  private async checkPostingRules(
    tx: Tx,
    facilityId: string,
    draft: Pick<JournalEntryDraft, 'sourceTable' | 'entryDate'> & {
      lines: Array<{ accountCode: string; partyId?: string | null }>;
    },
  ): Promise<void> {
    await this.periodLock.assertOpen(tx, facilityId, draft.entryDate);
    const accounts = await validateAccounts(tx, facilityId, draft.lines.map((l) => l.accountCode));
    const isManual = draft.sourceTable === 'manual';

    for (const line of draft.lines) {
      const account = accounts.get(line.accountCode)!;
      if (account.accountCode === SYSTEM_ACCOUNTS.CURRENT_YEAR_RESULT) {
        throw Errors.VALIDATION_ERROR(
          `${account.accountCode} ${account.accountName} is computed by the statements and cannot be posted to`,
          'lines',
        );
      }
      if (account.requiresParty && !line.partyId) {
        throw Errors.VALIDATION_ERROR(
          `Every line on ${account.accountCode} ${account.accountName} must name a party`,
          'lines',
        );
      }
      if (isManual && !account.allowManualPosting) {
        throw Errors.VALIDATION_ERROR(
          `${account.accountCode} ${account.accountName} is moved only by its own documents; correct it through them`,
          'lines',
        );
      }
    }
  }
}

type AccountRow = {
  accountCode: string;
  accountName: string;
  requiresParty: boolean;
  allowManualPosting: boolean;
};

/** Every referenced account must exist, be active, and not be a HEADER. */
async function validateAccounts(tx: Tx, facilityId: string, accountCodes: string[]): Promise<Map<string, AccountRow>> {
  const codes = Array.from(new Set(accountCodes));
  const accounts = await tx.chartOfAccounts.findMany({ where: { facilityId, accountCode: { in: codes } } });
  const byCode = new Map(accounts.map((a) => [a.accountCode, a]));
  for (const code of codes) {
    if (!byCode.has(code)) throw Errors.ACCOUNT_NOT_FOUND();
  }
  for (const a of accounts) {
    if (!a.isActive) throw Errors.ACCOUNT_INACTIVE();
    if (a.accountType === 'HEADER') throw Errors.HEADER_ACCOUNT_NOT_POSTABLE();
  }
  return byCode;
}

const entryInclude = {
  createdByUser: { select: { name: true } },
  reversedBy: { select: { entryNumber: true } },
  lines: {
    orderBy: { lineNumber: 'asc' as const },
    include: {
      account: { select: { accountName: true } },
      party: { select: { name: true } },
      lot: { select: { lotNumber: true } },
    },
  },
} satisfies Prisma.JournalEntryInclude;

type EntryWithRelations = Prisma.JournalEntryGetPayload<{ include: typeof entryInclude }>;

function formatEntry(e: EntryWithRelations) {
  return {
    id: e.id,
    facility_id: e.facilityId,
    entry_number: e.entryNumber,
    entry_date: toIsoDate(e.entryDate),
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
    is_reversed: e.reversedById !== null,
    is_user_reversible:
      e.postingStatus === 'POSTED' &&
      e.reversedById === null &&
      e.entryType !== 'REVERSAL' &&
      isUserReversibleSource(e.sourceTable),
    total_debit_pkr: round2(e.lines.reduce((s, l) => s + Number(l.debitAmount), 0)),
    total_credit_pkr: round2(e.lines.reduce((s, l) => s + Number(l.creditAmount), 0)),
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
