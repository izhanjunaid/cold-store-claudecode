import type { Prisma, PrismaClient } from '@coldchain/db';
import { round2, type CashFlowSectionName } from '@coldchain/shared';

/**
 * The one way to read the ledger (docs/25 §2 invariant 4).
 *
 * Every statement, sub-ledger and tie-out used to build its own query — 65
 * hand-written POSTED-and-book filters across 24 files, four sign conventions and
 * two "balanced" tolerances — and two of them had drifted into double-counting
 * reversed opening balances (L-03). They read through here instead.
 */

type Db = PrismaClient | Prisma.TransactionClient;
type Book = 'PACCI' | 'KATCHI';

export type Sums = { debit: number; credit: number };

/**
 * Lines that count toward balances: everything POSTED in the book. A reversal
 * and the entry it reverses are both posted and cancel each other, which is what
 * makes every balance reversal-correct without anyone filtering for it.
 */
export function postedLinesWhere(args: {
  facilityId: string;
  book: Book;
  from?: Date;
  to?: Date;
}): Prisma.JournalEntryLineWhereInput {
  return {
    facilityId: args.facilityId,
    journalEntry: {
      postingStatus: 'POSTED',
      bookType: args.book,
      ...(args.from || args.to
        ? { entryDate: { ...(args.from ? { gte: args.from } : {}), ...(args.to ? { lte: args.to } : {}) } }
        : {}),
    },
  };
}

/**
 * Entries that still stand as documents: posted, not reversed, and not themselves a
 * reversal. For readers that list *entries* (a document's journal, "has the opening
 * balance been entered?") rather than sum lines.
 */
export function standingEntriesWhere(facilityId: string): Prisma.JournalEntryWhereInput {
  return { facilityId, postingStatus: 'POSTED', reversedById: null, entryType: { not: 'REVERSAL' } };
}

/** Debit and credit totals per account over a date range. */
export async function accountBalances(
  db: Db,
  args: { facilityId: string; book: Book; from?: Date; to?: Date; accounts?: string[] },
): Promise<Map<string, Sums>> {
  const rows = await db.journalEntryLine.groupBy({
    by: ['accountCode'],
    where: {
      ...postedLinesWhere(args),
      ...(args.accounts ? { accountCode: { in: args.accounts } } : {}),
    },
    _sum: { debitAmount: true, creditAmount: true },
  });
  return new Map(
    rows.map((r) => [
      r.accountCode,
      { debit: round2(Number(r._sum.debitAmount ?? 0)), credit: round2(Number(r._sum.creditAmount ?? 0)) },
    ]),
  );
}

/**
 * Debit and credit totals per party on a set of control accounts — the sub-ledger
 * behind aging, statements and credit limits, read from the ledger itself so it
 * cannot disagree with it.
 */
export async function partyBalances(
  db: Db,
  args: { facilityId: string; book: Book; accounts: readonly string[]; to?: Date; partyId?: string },
): Promise<Map<string, Sums>> {
  const rows = await db.journalEntryLine.groupBy({
    by: ['partyId'],
    where: {
      ...postedLinesWhere({ facilityId: args.facilityId, book: args.book, to: args.to }),
      accountCode: { in: [...args.accounts] },
      partyId: args.partyId ?? { not: null },
    },
    _sum: { debitAmount: true, creditAmount: true },
  });
  return new Map(
    rows.map((r) => [
      r.partyId as string,
      { debit: round2(Number(r._sum.debitAmount ?? 0)), credit: round2(Number(r._sum.creditAmount ?? 0)) },
    ]),
  );
}

/** A balance on the account's own side: positive when it is where it normally sits. */
export function signedBalance(sums: Sums | undefined, normalBalance: 'DEBIT' | 'CREDIT'): number {
  if (!sums) return 0;
  return round2(normalBalance === 'DEBIT' ? sums.debit - sums.credit : sums.credit - sums.debit);
}

export type ClassifiableAccount = {
  accountCode: string;
  accountClass: string;
  accountType: string;
  parentAccountCode: string | null;
  statementSection: string | null;
  isCashEquivalent: boolean;
};

export type Classification = {
  /** Face-of-statement section; EQUITY for equity; UNCLASSIFIED for a detail under no sectioned header. */
  section: string;
  /** Where the account's cash movements land on the statement of cash flows, or CASH if it is cash. */
  cashFlow: CashFlowSectionName | 'CASH';
};

/**
 * Where an account sits on the statements — the one lookup the trial balance, the
 * P&L, the balance sheet and the cash-flow statement all use (docs/25 L-18).
 *
 * A DETAIL inherits its parent header's section (the chart is one level deep:
 * coa.service refuses a HEADER under a HEADER). The cash-flow statement used to
 * read the section off the detail account itself, which is always null, so every
 * capital purchase and loan drawdown landed in Operating (L-01).
 */
export function classify(account: ClassifiableAccount, chartByCode: Map<string, ClassifiableAccount>): Classification {
  const section =
    account.accountClass === 'EQUITY'
      ? 'EQUITY'
      : account.accountType === 'HEADER'
        ? (account.statementSection ?? 'UNCLASSIFIED')
        : ((account.parentAccountCode ? chartByCode.get(account.parentAccountCode)?.statementSection : null) ??
          'UNCLASSIFIED');

  let cashFlow: Classification['cashFlow'];
  if (account.isCashEquivalent) cashFlow = 'CASH';
  else if (section === 'EQUITY' || section === 'NON_CURRENT_LIABILITY') cashFlow = 'FINANCING';
  else if (section === 'NON_CURRENT_ASSET') cashFlow = 'INVESTING';
  else cashFlow = 'OPERATING';

  return { section, cashFlow };
}
