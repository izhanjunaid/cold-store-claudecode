import type { PrismaClient, Prisma } from '@coldchain/db';

/**
 * Statement of Cash Flows, direct method.
 *
 * IFRS for SMEs §7 permits either method and the direct one is far more useful
 * to an owner — it says where the money actually went, rather than starting
 * from profit and adjusting.
 *
 * It is also the simpler implementation here. Every movement of money in this
 * system is a journal line touching a cash account, so the statement is built
 * by taking those entries and classifying each by its COUNTERPART line. No new
 * store, no second source of truth: the same journal_entry_lines every other
 * statement reads.
 */

/**
 * 1025 Cheques in Hand is deliberately NOT cash. A received cheque can still
 * bounce — which is the entire reason phase/25 created the account. So a cheque
 * receipt (DR 1025 / CR AR) is not a cash movement and never enters this
 * statement, and the JE-24 clearing entry (DR 1020 / CR 1025) is where the
 * money actually arrives. Treating 1025 as cash would count every cheque twice.
 */
const CASH_ACCOUNTS = ['1010', '1020', '1030'];

export type CashFlowLine = { account_code: string; account_name: string; amount_pkr: number };
export type CashFlowSectionName = 'OPERATING' | 'INVESTING' | 'FINANCING';

export type CashFlowResponse = {
  date_from: string;
  date_to: string;
  operating_lines: CashFlowLine[];
  total_operating_pkr: number;
  investing_lines: CashFlowLine[];
  total_investing_pkr: number;
  financing_lines: CashFlowLine[];
  total_financing_pkr: number;
  net_change_pkr: number;
  opening_cash_pkr: number;
  closing_cash_pkr: number;
  /** Composition of "cash and cash equivalents" at the closing date. */
  cash_composition: CashFlowLine[];
  /** Cheques received but not yet cleared — disclosed, not counted as cash. */
  cheques_in_hand_pkr: number;
  /**
   * Closing cash per this statement equals cash on the balance sheet at the
   * same date. If this is ever false the statement is lying and must say so
   * on its face, exactly as the other statements carry is_balanced.
   */
  is_reconciled: boolean;
};

type Account = { accountCode: string; accountName: string; accountClass: string; statementSection: string | null; cashFlowSection: string | null };

/**
 * Where a counterpart account's movements belong, derived from the
 * classification the chart already carries. `cash_flow_section` overrides it
 * for the handful of accounts the derivation gets wrong.
 */
export function deriveCashFlowSection(a: Account): CashFlowSectionName {
  if (a.cashFlowSection) return a.cashFlowSection as CashFlowSectionName;
  if (a.accountClass === 'EQUITY') return 'FINANCING';
  switch (a.statementSection) {
    case 'NON_CURRENT_ASSET':
      return 'INVESTING';
    case 'NON_CURRENT_LIABILITY':
      return 'FINANCING';
    default:
      // Working capital and everything on the P&L is operating. Accounts with
      // no statement_section at all land here too, which is the right default:
      // an unclassified account is far more likely to be an ordinary trading
      // item than a capital or funding one, and operating is where the reader
      // will look for something they cannot find elsewhere.
      return 'OPERATING';
  }
}

export class CashFlowService {
  constructor(private prisma: PrismaClient) {}

  private async cashBalanceAt(facilityId: string, date: Date, bookType: 'PACCI' | 'KATCHI', codes: string[]) {
    const agg = await this.prisma.journalEntryLine.groupBy({
      by: ['accountCode'],
      where: {
        facilityId,
        accountCode: { in: codes },
        journalEntry: { postingStatus: 'POSTED', bookType, entryDate: { lte: date } },
      },
      _sum: { debitAmount: true, creditAmount: true },
    });
    const byCode = new Map<string, number>();
    for (const r of agg) {
      byCode.set(
        r.accountCode,
        Math.round((Number(r._sum.debitAmount ?? 0) - Number(r._sum.creditAmount ?? 0)) * 100) / 100,
      );
    }
    return byCode;
  }

  async getCashFlow(
    facilityId: string,
    params: { date_from: string; date_to: string; book_type: 'PACCI' | 'KATCHI' },
  ): Promise<CashFlowResponse> {
    const from = new Date(`${params.date_from}T00:00:00.000Z`);
    const to = new Date(`${params.date_to}T00:00:00.000Z`);
    const dayBefore = new Date(from.getTime() - 24 * 60 * 60 * 1000);

    const accounts = (await this.prisma.chartOfAccounts.findMany({
      where: { facilityId },
      select: {
        accountCode: true,
        accountName: true,
        accountClass: true,
        statementSection: true,
        cashFlowSection: true,
      },
    })) as Account[];
    const byCode = new Map(accounts.map((a) => [a.accountCode, a]));

    // Every entry in the window that moves cash.
    const cashEntryIds = (
      await this.prisma.journalEntryLine.findMany({
        where: {
          facilityId,
          accountCode: { in: CASH_ACCOUNTS },
          journalEntry: {
            postingStatus: 'POSTED',
            bookType: params.book_type,
            entryDate: { gte: from, lte: to },
          },
        },
        select: { journalEntryId: true },
        distinct: ['journalEntryId'],
      })
    ).map((l) => l.journalEntryId);

    const lines = await this.prisma.journalEntryLine.findMany({
      where: { journalEntryId: { in: cashEntryIds } },
      select: { journalEntryId: true, accountCode: true, debitAmount: true, creditAmount: true },
    });

    const grouped = new Map<string, typeof lines>();
    for (const l of lines) {
      const list = grouped.get(l.journalEntryId) ?? [];
      list.push(l);
      grouped.set(l.journalEntryId, list);
    }

    const totals = new Map<CashFlowSectionName, Map<string, number>>([
      ['OPERATING', new Map()],
      ['INVESTING', new Map()],
      ['FINANCING', new Map()],
    ]);

    for (const entryLines of grouped.values()) {
      const counterparts = entryLines.filter((l) => !CASH_ACCOUNTS.includes(l.accountCode));
      // Cash moved between two cash accounts and nowhere else — a transfer, not
      // a flow. Reporting it would inflate both an inflow and an outflow that
      // together changed nothing.
      if (counterparts.length === 0) continue;

      for (const l of counterparts) {
        const account = byCode.get(l.accountCode);
        if (!account) continue;
        const section = deriveCashFlowSection(account);
        // A credited counterpart means cash came in; a debited one means it
        // went out. That mirrors the double entry exactly, so the section
        // amounts sum to the entry's net cash movement with nothing left over.
        const effect = Number(l.creditAmount) - Number(l.debitAmount);
        if (effect === 0) continue;
        const bucket = totals.get(section)!;
        bucket.set(l.accountCode, (bucket.get(l.accountCode) ?? 0) + effect);
      }
    }

    const toLines = (section: CashFlowSectionName): CashFlowLine[] =>
      [...totals.get(section)!.entries()]
        .map(([code, amount]) => ({
          account_code: code,
          account_name: byCode.get(code)?.accountName ?? code,
          amount_pkr: Math.round(amount * 100) / 100,
        }))
        .filter((l) => l.amount_pkr !== 0)
        .sort((a, b) => a.account_code.localeCompare(b.account_code));

    const sum = (ls: CashFlowLine[]) => Math.round(ls.reduce((s, l) => s + l.amount_pkr, 0) * 100) / 100;

    const operating_lines = toLines('OPERATING');
    const investing_lines = toLines('INVESTING');
    const financing_lines = toLines('FINANCING');
    const total_operating_pkr = sum(operating_lines);
    const total_investing_pkr = sum(investing_lines);
    const total_financing_pkr = sum(financing_lines);
    const net_change_pkr =
      Math.round((total_operating_pkr + total_investing_pkr + total_financing_pkr) * 100) / 100;

    const openingByCode = await this.cashBalanceAt(facilityId, dayBefore, params.book_type, CASH_ACCOUNTS);
    const closingByCode = await this.cashBalanceAt(facilityId, to, params.book_type, CASH_ACCOUNTS);
    const opening_cash_pkr =
      Math.round([...openingByCode.values()].reduce((s, v) => s + v, 0) * 100) / 100;
    const closing_cash_pkr =
      Math.round([...closingByCode.values()].reduce((s, v) => s + v, 0) * 100) / 100;

    const chequesByCode = await this.cashBalanceAt(facilityId, to, params.book_type, ['1025']);

    return {
      date_from: params.date_from,
      date_to: params.date_to,
      operating_lines,
      total_operating_pkr,
      investing_lines,
      total_investing_pkr,
      financing_lines,
      total_financing_pkr,
      net_change_pkr,
      opening_cash_pkr,
      closing_cash_pkr,
      cash_composition: CASH_ACCOUNTS.map((code) => ({
        account_code: code,
        account_name: byCode.get(code)?.accountName ?? code,
        amount_pkr: closingByCode.get(code) ?? 0,
      })).filter((l) => l.amount_pkr !== 0),
      cheques_in_hand_pkr: chequesByCode.get('1025') ?? 0,
      is_reconciled: Math.abs(opening_cash_pkr + net_change_pkr - closing_cash_pkr) < 0.005,
    };
  }
}
