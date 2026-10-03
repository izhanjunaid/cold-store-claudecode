import type { PrismaClient } from '@coldchain/db';
import {
  SYSTEM_ACCOUNTS,
  dayBefore,
  fromIsoDate,
  moneyEquals,
  round2,
  sumMoney,
  type CashFlowSectionName,
} from '@coldchain/shared';
import { accountBalances, classify, postedLinesWhere, signedBalance, type ClassifiableAccount } from './ledger';
import { FinancialStatementsService } from './financial-statements.service';

/**
 * Statement of Cash Flows, direct method.
 *
 * IFRS for SMEs §7 permits either method and the direct one is far more useful
 * to an owner — it says where the money actually went, rather than starting
 * from profit and adjusting.
 *
 * Every movement of money is a journal line touching a cash-equivalent account,
 * so the statement takes those entries and places each COUNTERPART line in the
 * section `classify` gives it — the same lookup every other statement uses
 * (docs/25 L-01). Cash is whatever the chart flags `is_cash_equivalent`, so an
 * owner's second bank account is cash exactly as 1020 is (L-20).
 *
 * 1025 Cheques in Hand is deliberately NOT cash: a received cheque can still
 * bounce, which is the whole reason the account exists. A cheque receipt is not
 * a cash movement; the clearing entry (DR bank / CR 1025) is where the money
 * arrives. Counting 1025 as cash would count every cheque twice.
 */

export type CashFlowLine = { account_code: string; account_name: string; amount_pkr: number };

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
  /** Cash and cash equivalents on the balance sheet at date_to. */
  closing_cash_pkr: number;
  /** Composition of "cash and cash equivalents" at the closing date. */
  cash_composition: CashFlowLine[];
  /** Cheques received but not yet cleared — disclosed, not counted as cash. */
  cheques_in_hand_pkr: number;
  /**
   * Opening cash plus the flows on this statement equals the balance sheet's
   * cash and cash equivalents at date_to. The two sides are computed
   * independently — flows from the entries in the window, closing from the
   * balance sheet — so a false here means the statement is missing a flow.
   */
  is_reconciled: boolean;
};

type ChartRow = ClassifiableAccount & { accountName: string; normalBalance: 'DEBIT' | 'CREDIT' };

export class CashFlowService {
  private statements: FinancialStatementsService;

  constructor(private prisma: PrismaClient) {
    this.statements = new FinancialStatementsService(prisma);
  }

  async getCashFlow(
    facilityId: string,
    params: { date_from: string; date_to: string; book_type: 'PACCI' | 'KATCHI' },
  ): Promise<CashFlowResponse> {
    const book = params.book_type;
    const from = fromIsoDate(params.date_from);
    const to = fromIsoDate(params.date_to);

    const chart = (await this.prisma.chartOfAccounts.findMany({
      where: { facilityId },
      select: {
        accountCode: true,
        accountName: true,
        accountClass: true,
        accountType: true,
        parentAccountCode: true,
        statementSection: true,
        isCashEquivalent: true,
        normalBalance: true,
      },
    })) as ChartRow[];
    const byCode = new Map(chart.map((a) => [a.accountCode, a]));
    const cashCodes = chart.filter((a) => a.isCashEquivalent).map((a) => a.accountCode);

    // Every entry in the window that moves cash, and all of its lines.
    const cashEntryIds = (
      await this.prisma.journalEntryLine.findMany({
        where: { ...postedLinesWhere({ facilityId, book, from, to }), accountCode: { in: cashCodes } },
        select: { journalEntryId: true },
        distinct: ['journalEntryId'],
      })
    ).map((l) => l.journalEntryId);
    const lines = await this.prisma.journalEntryLine.findMany({
      where: { journalEntryId: { in: cashEntryIds } },
      select: { accountCode: true, debitAmount: true, creditAmount: true },
    });

    const totals = new Map<CashFlowSectionName, Map<string, number>>([
      ['OPERATING', new Map()],
      ['INVESTING', new Map()],
      ['FINANCING', new Map()],
    ]);
    for (const l of lines) {
      const account = byCode.get(l.accountCode)!;
      const { cashFlow } = classify(account, byCode);
      // A cash line is the movement itself, not its cause. An entry with no
      // counterpart at all moved money between two of the facility's own
      // accounts — a transfer, which changes nothing.
      if (cashFlow === 'CASH') continue;
      // A credited counterpart means cash came in; a debited one means it went
      // out. That mirrors the double entry, so the section amounts sum to the
      // entry's net cash movement with nothing left over.
      const effect = Number(l.creditAmount) - Number(l.debitAmount);
      const bucket = totals.get(cashFlow)!;
      bucket.set(l.accountCode, (bucket.get(l.accountCode) ?? 0) + effect);
    }

    const toLines = (section: CashFlowSectionName): CashFlowLine[] =>
      [...totals.get(section)!.entries()]
        .map(([code, amount]) => ({ account_code: code, account_name: byCode.get(code)!.accountName, amount_pkr: round2(amount) }))
        .filter((l) => l.amount_pkr !== 0)
        .sort((a, b) => a.account_code.localeCompare(b.account_code));
    const total = (ls: CashFlowLine[]) => sumMoney(ls.map((l) => l.amount_pkr));

    const operating_lines = toLines('OPERATING');
    const investing_lines = toLines('INVESTING');
    const financing_lines = toLines('FINANCING');
    const total_operating_pkr = total(operating_lines);
    const total_investing_pkr = total(investing_lines);
    const total_financing_pkr = total(financing_lines);
    const net_change_pkr = round2(total_operating_pkr + total_investing_pkr + total_financing_pkr);

    const [opening, closing, bs] = await Promise.all([
      accountBalances(this.prisma, { facilityId, book, to: fromIsoDate(dayBefore(params.date_from)), accounts: cashCodes }),
      accountBalances(this.prisma, {
        facilityId,
        book,
        to,
        accounts: [...cashCodes, SYSTEM_ACCOUNTS.CHEQUES_IN_HAND],
      }),
      this.statements.getBalanceSheet(facilityId, { as_of_date: params.date_to, book_type: book }),
    ]);
    const balance = (sums: typeof opening, code: string) => signedBalance(sums.get(code), byCode.get(code)!.normalBalance);
    const opening_cash_pkr = sumMoney(cashCodes.map((c) => balance(opening, c)));

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
      closing_cash_pkr: bs.cash_and_cash_equivalents_pkr,
      cash_composition: cashCodes
        .map((code) => ({ account_code: code, account_name: byCode.get(code)!.accountName, amount_pkr: balance(closing, code) }))
        .filter((l) => l.amount_pkr !== 0)
        .sort((a, b) => a.account_code.localeCompare(b.account_code)),
      cheques_in_hand_pkr: balance(closing, SYSTEM_ACCOUNTS.CHEQUES_IN_HAND),
      is_reconciled: moneyEquals(opening_cash_pkr + net_change_pkr, bs.cash_and_cash_equivalents_pkr),
    };
  }
}
