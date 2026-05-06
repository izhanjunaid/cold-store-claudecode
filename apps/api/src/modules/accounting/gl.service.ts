import type { PrismaClient, Prisma, NormalBalance } from '@coldchain/db';
import { Errors } from '../../common/errors';
import type {
  GeneralLedgerQueryType,
  TrialBalanceQueryType,
} from '@coldchain/shared';

type Tx = PrismaClient | Prisma.TransactionClient;

export class GlService {
  constructor(private prisma: PrismaClient) {}

  /**
   * General ledger for a single account, with running balance computed from openings + lines.
   *
   * Opening balance = sum(debit) - sum(credit) BEFORE date_from (or 0 if no date_from), signed
   * by the account's normal balance:
   *   normal=DEBIT  → balance = debit_total - credit_total
   *   normal=CREDIT → balance = credit_total - debit_total
   */
  async getAccountLedger(facilityId: string, query: GeneralLedgerQueryType) {
    const account = await this.prisma.chartOfAccounts.findUnique({
      where: { facilityId_accountCode: { facilityId, accountCode: query.account_code } },
    });
    if (!account) throw Errors.ACCOUNT_NOT_FOUND();

    const baseEntryWhere: Prisma.JournalEntryWhereInput = {
      facilityId,
      postingStatus: { in: ['POSTED'] },
    };
    if (query.book_type) baseEntryWhere.bookType = query.book_type;

    const lineWhere = (dateClause: Prisma.JournalEntryWhereInput['entryDate']): Prisma.JournalEntryLineWhereInput => ({
      facilityId,
      accountCode: query.account_code,
      ...(query.party_id ? { partyId: query.party_id } : {}),
      journalEntry: {
        ...baseEntryWhere,
        ...(dateClause ? { entryDate: dateClause } : {}),
      },
    });

    // Opening balance: sum of all lines BEFORE date_from
    let opening = 0;
    if (query.date_from) {
      const openingAgg = await this.prisma.journalEntryLine.aggregate({
        where: lineWhere({ lt: new Date(query.date_from) }),
        _sum: { debitAmount: true, creditAmount: true },
      });
      opening = signedDelta(
        Number(openingAgg._sum.debitAmount ?? 0),
        Number(openingAgg._sum.creditAmount ?? 0),
        account.normalBalance,
      );
    }

    const dateClause: Prisma.JournalEntryWhereInput['entryDate'] | undefined =
      query.date_from || query.date_to
        ? {
            ...(query.date_from ? { gte: new Date(query.date_from) } : {}),
            ...(query.date_to ? { lte: new Date(query.date_to) } : {}),
          }
        : undefined;

    const lines = await this.prisma.journalEntryLine.findMany({
      where: lineWhere(dateClause),
      include: {
        journalEntry: { select: { id: true, entryNumber: true, entryDate: true, description: true } },
        party: { select: { name: true } },
        lot: { select: { lotNumber: true } },
      },
      orderBy: [
        { journalEntry: { entryDate: 'asc' } },
        { journalEntry: { createdAt: 'asc' } },
        { lineNumber: 'asc' },
      ],
    });

    let balance = opening;
    let totalDebit = 0;
    let totalCredit = 0;
    const entries = lines.map((l) => {
      const d = Number(l.debitAmount);
      const c = Number(l.creditAmount);
      totalDebit += d;
      totalCredit += c;
      balance += signedDelta(d, c, account.normalBalance);
      return {
        date: l.journalEntry.entryDate.toISOString().slice(0, 10),
        entry_number: l.journalEntry.entryNumber,
        entry_id: l.journalEntry.id,
        description: l.description ?? l.journalEntry.description,
        party_name: l.party?.name ?? null,
        lot_number: l.lot?.lotNumber ?? null,
        debit_pkr: round2(d),
        credit_pkr: round2(c),
        balance_pkr: round2(balance),
      };
    });

    return {
      account_code: account.accountCode,
      account_name: account.accountName,
      account_class: account.accountClass,
      normal_balance: account.normalBalance,
      date_from: query.date_from ?? null,
      date_to: query.date_to ?? null,
      opening_balance_pkr: round2(opening),
      total_debit_pkr: round2(totalDebit),
      total_credit_pkr: round2(totalCredit),
      closing_balance_pkr: round2(balance),
      entries,
    };
  }

  /**
   * Trial balance: per-account ending balance over [date_from, date_to].
   *
   * For each account, compute SUM(debit) - SUM(credit). Place positive value in `debit_balance`
   * if the account's normal_balance is DEBIT (or the net is debit), otherwise in `credit_balance`.
   * Total debit must equal total credit.
   */
  async getTrialBalance(facilityId: string, query: TrialBalanceQueryType) {
    const dateClause: Prisma.JournalEntryWhereInput['entryDate'] | undefined =
      query.date_from || query.date_to
        ? {
            ...(query.date_from ? { gte: new Date(query.date_from) } : {}),
            ...(query.date_to ? { lte: new Date(query.date_to) } : {}),
          }
        : undefined;

    const lines = await this.prisma.journalEntryLine.findMany({
      where: {
        facilityId,
        journalEntry: {
          facilityId,
          postingStatus: 'POSTED',
          ...(query.book_type ? { bookType: query.book_type } : {}),
          ...(dateClause ? { entryDate: dateClause } : {}),
        },
      },
      select: { accountCode: true, debitAmount: true, creditAmount: true },
    });

    const accounts = await this.prisma.chartOfAccounts.findMany({
      where: { facilityId },
      orderBy: { accountCode: 'asc' },
    });

    const sumByCode = new Map<string, { debit: number; credit: number }>();
    for (const l of lines) {
      const cur = sumByCode.get(l.accountCode) ?? { debit: 0, credit: 0 };
      cur.debit += Number(l.debitAmount);
      cur.credit += Number(l.creditAmount);
      sumByCode.set(l.accountCode, cur);
    }

    let totalDebit = 0;
    let totalCredit = 0;
    const rows: Array<{
      account_code: string;
      account_name: string;
      account_class: string;
      normal_balance: NormalBalance;
      debit_balance_pkr: number;
      credit_balance_pkr: number;
    }> = [];

    for (const a of accounts) {
      const sums = sumByCode.get(a.accountCode);
      if (!sums || (sums.debit === 0 && sums.credit === 0)) continue;
      const net = sums.debit - sums.credit;
      const debitBal = net > 0 ? net : 0;
      const creditBal = net < 0 ? -net : 0;
      totalDebit += debitBal;
      totalCredit += creditBal;
      rows.push({
        account_code: a.accountCode,
        account_name: a.accountName,
        account_class: a.accountClass,
        normal_balance: a.normalBalance,
        debit_balance_pkr: round2(debitBal),
        credit_balance_pkr: round2(creditBal),
      });
    }

    return {
      date_from: query.date_from ?? null,
      date_to: query.date_to ?? new Date().toISOString().slice(0, 10),
      rows,
      total_debit_pkr: round2(totalDebit),
      total_credit_pkr: round2(totalCredit),
      is_balanced: Math.abs(totalDebit - totalCredit) < 0.005,
    };
  }
}

function signedDelta(debit: number, credit: number, normal: NormalBalance): number {
  return normal === 'DEBIT' ? debit - credit : credit - debit;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
