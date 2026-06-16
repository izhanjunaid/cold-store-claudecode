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
   * Trial balance over [date_from, date_to] — professional 6-column form:
   *   Opening (Dr/Cr) · Period movement (Dr/Cr) · Closing (Dr/Cr)
   *
   * Opening = net of all postings strictly BEFORE date_from (0 if no date_from).
   * Movement = gross period debits and credits.
   * Closing = opening net + period net, placed on the resulting side.
   * Rows are grouped by account class with per-class subtotals; the grand
   * closing totals must balance (total Dr == total Cr).
   */
  async getTrialBalance(facilityId: string, query: TrialBalanceQueryType) {
    const baseEntry = (clause: Prisma.JournalEntryWhereInput['entryDate']): Prisma.JournalEntryLineWhereInput => ({
      facilityId,
      journalEntry: {
        facilityId,
        postingStatus: 'POSTED',
        ...(query.book_type ? { bookType: query.book_type } : {}),
        ...(clause ? { entryDate: clause } : {}),
      },
    });

    const periodClause: Prisma.JournalEntryWhereInput['entryDate'] | undefined =
      query.date_from || query.date_to
        ? {
            ...(query.date_from ? { gte: new Date(query.date_from) } : {}),
            ...(query.date_to ? { lte: new Date(query.date_to) } : {}),
          }
        : undefined;

    const periodLines = await this.prisma.journalEntryLine.findMany({
      where: baseEntry(periodClause),
      select: { accountCode: true, debitAmount: true, creditAmount: true },
    });

    // Opening balances: all postings strictly before date_from
    const openingByCode = new Map<string, { debit: number; credit: number }>();
    if (query.date_from) {
      const openingLines = await this.prisma.journalEntryLine.findMany({
        where: baseEntry({ lt: new Date(query.date_from) }),
        select: { accountCode: true, debitAmount: true, creditAmount: true },
      });
      for (const l of openingLines) {
        const cur = openingByCode.get(l.accountCode) ?? { debit: 0, credit: 0 };
        cur.debit += Number(l.debitAmount);
        cur.credit += Number(l.creditAmount);
        openingByCode.set(l.accountCode, cur);
      }
    }

    const periodByCode = new Map<string, { debit: number; credit: number }>();
    for (const l of periodLines) {
      const cur = periodByCode.get(l.accountCode) ?? { debit: 0, credit: 0 };
      cur.debit += Number(l.debitAmount);
      cur.credit += Number(l.creditAmount);
      periodByCode.set(l.accountCode, cur);
    }

    const accounts = await this.prisma.chartOfAccounts.findMany({
      where: { facilityId },
      orderBy: { accountCode: 'asc' },
    });

    const blankSub = () => ({
      opening_debit_pkr: 0,
      opening_credit_pkr: 0,
      movement_debit_pkr: 0,
      movement_credit_pkr: 0,
      debit_balance_pkr: 0,
      credit_balance_pkr: 0,
    });

    const groupMap = new Map<string, { account_class: string; label: string; rows: TrialBalanceRow[]; subtotal: ReturnType<typeof blankSub> }>();
    const totals = blankSub();

    for (const a of accounts) {
      const open = openingByCode.get(a.accountCode) ?? { debit: 0, credit: 0 };
      const per = periodByCode.get(a.accountCode) ?? { debit: 0, credit: 0 };
      const openingNet = open.debit - open.credit;
      const closingNet = openingNet + (per.debit - per.credit);
      if (openingNet === 0 && per.debit === 0 && per.credit === 0 && closingNet === 0) continue;

      const row: TrialBalanceRow = {
        account_code: a.accountCode,
        account_name: a.accountName,
        account_class: a.accountClass,
        normal_balance: a.normalBalance,
        opening_debit_pkr: round2(Math.max(openingNet, 0)),
        opening_credit_pkr: round2(Math.max(-openingNet, 0)),
        movement_debit_pkr: round2(per.debit),
        movement_credit_pkr: round2(per.credit),
        debit_balance_pkr: round2(Math.max(closingNet, 0)),
        credit_balance_pkr: round2(Math.max(-closingNet, 0)),
      };

      let g = groupMap.get(a.accountClass);
      if (!g) {
        g = { account_class: a.accountClass, label: CLASS_LABEL[a.accountClass] ?? a.accountClass, rows: [], subtotal: blankSub() };
        groupMap.set(a.accountClass, g);
      }
      g.rows.push(row);
      for (const k of Object.keys(totals) as (keyof ReturnType<typeof blankSub>)[]) {
        g.subtotal[k] = round2(g.subtotal[k] + row[k]);
        totals[k] = round2(totals[k] + row[k]);
      }
    }

    const groups = CLASS_ORDER.filter((c) => groupMap.has(c)).map((c) => groupMap.get(c)!);

    return {
      date_from: query.date_from ?? null,
      date_to: query.date_to ?? new Date().toISOString().slice(0, 10),
      groups,
      // Flat row list retained for convenience / back-compat
      rows: groups.flatMap((g) => g.rows),
      total_opening_debit_pkr: totals.opening_debit_pkr,
      total_opening_credit_pkr: totals.opening_credit_pkr,
      total_movement_debit_pkr: totals.movement_debit_pkr,
      total_movement_credit_pkr: totals.movement_credit_pkr,
      total_debit_pkr: totals.debit_balance_pkr,
      total_credit_pkr: totals.credit_balance_pkr,
      is_balanced: Math.abs(totals.debit_balance_pkr - totals.credit_balance_pkr) < 0.005,
    };
  }
}

interface TrialBalanceRow {
  account_code: string;
  account_name: string;
  account_class: string;
  normal_balance: NormalBalance;
  opening_debit_pkr: number;
  opening_credit_pkr: number;
  movement_debit_pkr: number;
  movement_credit_pkr: number;
  debit_balance_pkr: number;
  credit_balance_pkr: number;
}

const CLASS_ORDER = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'COST_OF_SERVICE', 'EXPENSE'] as const;
const CLASS_LABEL: Record<string, string> = {
  ASSET: 'Assets',
  LIABILITY: 'Liabilities',
  EQUITY: 'Equity',
  REVENUE: 'Revenue',
  COST_OF_SERVICE: 'Cost of Service',
  EXPENSE: 'Operating Expenses',
};

function signedDelta(debit: number, credit: number, normal: NormalBalance): number {
  return normal === 'DEBIT' ? debit - credit : credit - debit;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
