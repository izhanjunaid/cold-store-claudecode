import type { PrismaClient, Prisma } from '@coldchain/db';
import type { ProfitLossQueryType, BalanceSheetQueryType } from '@coldchain/shared';

export class FinancialStatementsService {
  constructor(private prisma: PrismaClient) {}

  /**
   * P&L over [date_from, date_to]:
   *   - Revenue: SUM(credit) - SUM(debit) per REVENUE account
   *   - Cost of service: SUM(debit) - SUM(credit) per COST_OF_SERVICE account
   *   - Gross profit = revenue - cost_of_service
   *   - Expenses: SUM(debit) - SUM(credit) per EXPENSE account
   *   - Net profit = gross profit - expenses
   */
  async getProfitLoss(facilityId: string, query: ProfitLossQueryType) {
    const lines = await this.fetchLines(facilityId, query.date_from, query.date_to, query.book_type);
    const accounts = await this.prisma.chartOfAccounts.findMany({
      where: { facilityId },
      orderBy: { accountCode: 'asc' },
    });

    const sumByCode = aggregate(lines);

    const revenue = accounts
      .filter((a) => a.accountClass === 'REVENUE' && a.accountType === 'DETAIL')
      .map((a) => {
        const s = sumByCode.get(a.accountCode);
        const amount = s ? s.credit - s.debit : 0;
        return { account_code: a.accountCode, account_name: a.accountName, amount_pkr: round2(amount) };
      })
      .filter((l) => l.amount_pkr !== 0);

    const cos = accounts
      .filter((a) => a.accountClass === 'COST_OF_SERVICE' && a.accountType === 'DETAIL')
      .map((a) => {
        const s = sumByCode.get(a.accountCode);
        const amount = s ? s.debit - s.credit : 0;
        return { account_code: a.accountCode, account_name: a.accountName, amount_pkr: round2(amount) };
      })
      .filter((l) => l.amount_pkr !== 0);

    const expense = accounts
      .filter((a) => a.accountClass === 'EXPENSE' && a.accountType === 'DETAIL')
      .map((a) => {
        const s = sumByCode.get(a.accountCode);
        const amount = s ? s.debit - s.credit : 0;
        return { account_code: a.accountCode, account_name: a.accountName, amount_pkr: round2(amount) };
      })
      .filter((l) => l.amount_pkr !== 0);

    const totalRevenue = revenue.reduce((s, l) => s + l.amount_pkr, 0);
    const totalCos = cos.reduce((s, l) => s + l.amount_pkr, 0);
    const grossProfit = totalRevenue - totalCos;
    const totalExpense = expense.reduce((s, l) => s + l.amount_pkr, 0);
    const netProfit = grossProfit - totalExpense;

    return {
      date_from: query.date_from,
      date_to: query.date_to,
      revenue_lines: revenue,
      total_revenue_pkr: round2(totalRevenue),
      cost_of_service_lines: cos,
      total_cost_of_service_pkr: round2(totalCos),
      gross_profit_pkr: round2(grossProfit),
      gross_profit_pct: totalRevenue > 0 ? round2((grossProfit / totalRevenue) * 100) : 0,
      expense_lines: expense,
      total_expense_pkr: round2(totalExpense),
      net_profit_pkr: round2(netProfit),
      net_profit_pct: totalRevenue > 0 ? round2((netProfit / totalRevenue) * 100) : 0,
    };
  }

  /**
   * Balance sheet as of `as_of_date`:
   *   - Asset balance per account: debit - credit (DEBIT-normal accounts)
   *   - Liability/Equity balance: credit - debit (CREDIT-normal accounts)
   *   - Current Year P&L equity = revenue - costs - expenses YTD (as of as_of_date)
   *   - Equation: Assets = Liabilities + Equity
   */
  async getBalanceSheet(facilityId: string, query: BalanceSheetQueryType) {
    const lines = await this.fetchLines(facilityId, undefined, query.as_of_date, query.book_type);
    const accounts = await this.prisma.chartOfAccounts.findMany({
      where: { facilityId },
      orderBy: { accountCode: 'asc' },
    });

    const sumByCode = aggregate(lines);

    const assets = accounts
      .filter((a) => a.accountClass === 'ASSET' && a.accountType === 'DETAIL')
      .map((a) => balanceLine(a, sumByCode))
      .filter((l) => l.amount_pkr !== 0);

    const liabilities = accounts
      .filter((a) => a.accountClass === 'LIABILITY' && a.accountType === 'DETAIL')
      .map((a) => balanceLine(a, sumByCode))
      .filter((l) => l.amount_pkr !== 0);

    const equity = accounts
      .filter((a) => a.accountClass === 'EQUITY' && a.accountType === 'DETAIL')
      .map((a) => balanceLine(a, sumByCode))
      .filter((l) => l.amount_pkr !== 0);

    // Current year P&L = revenue - cos - expense, year-to-date inside as_of_date
    let currentYearPL = 0;
    for (const a of accounts) {
      if (a.accountType !== 'DETAIL') continue;
      const s = sumByCode.get(a.accountCode);
      if (!s) continue;
      if (a.accountClass === 'REVENUE') currentYearPL += s.credit - s.debit;
      else if (a.accountClass === 'COST_OF_SERVICE') currentYearPL -= s.debit - s.credit;
      else if (a.accountClass === 'EXPENSE') currentYearPL -= s.debit - s.credit;
    }

    const totalAssets = assets.reduce((s, l) => s + l.amount_pkr, 0);
    const totalLiabilities = liabilities.reduce((s, l) => s + l.amount_pkr, 0);
    const totalEquityExclPL = equity.reduce((s, l) => s + l.amount_pkr, 0);
    const totalEquity = totalEquityExclPL + currentYearPL;
    const totalLE = totalLiabilities + totalEquity;

    return {
      as_of_date: query.as_of_date,
      asset_lines: assets,
      total_assets_pkr: round2(totalAssets),
      liability_lines: liabilities,
      total_liabilities_pkr: round2(totalLiabilities),
      equity_lines: equity,
      current_year_pl_pkr: round2(currentYearPL),
      total_equity_pkr: round2(totalEquity),
      total_liabilities_and_equity_pkr: round2(totalLE),
      is_balanced: Math.abs(totalAssets - totalLE) < 0.01,
    };
  }

  private async fetchLines(
    facilityId: string,
    dateFrom?: string,
    dateTo?: string,
    bookType?: string,
  ) {
    const dateClause: Prisma.JournalEntryWhereInput['entryDate'] | undefined =
      dateFrom || dateTo
        ? {
            ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
            ...(dateTo ? { lte: new Date(dateTo) } : {}),
          }
        : undefined;

    return this.prisma.journalEntryLine.findMany({
      where: {
        facilityId,
        journalEntry: {
          facilityId,
          postingStatus: 'POSTED',
          ...(bookType ? { bookType: bookType as any } : {}),
          ...(dateClause ? { entryDate: dateClause } : {}),
        },
      },
      select: { accountCode: true, debitAmount: true, creditAmount: true },
    });
  }
}

function aggregate(lines: { accountCode: string; debitAmount: any; creditAmount: any }[]) {
  const m = new Map<string, { debit: number; credit: number }>();
  for (const l of lines) {
    const cur = m.get(l.accountCode) ?? { debit: 0, credit: 0 };
    cur.debit += Number(l.debitAmount);
    cur.credit += Number(l.creditAmount);
    m.set(l.accountCode, cur);
  }
  return m;
}

function balanceLine(
  a: { accountCode: string; accountName: string; normalBalance: 'DEBIT' | 'CREDIT' },
  sumByCode: Map<string, { debit: number; credit: number }>,
) {
  const s = sumByCode.get(a.accountCode);
  const amount = s
    ? a.normalBalance === 'DEBIT'
      ? s.debit - s.credit
      : s.credit - s.debit
    : 0;
  return {
    account_code: a.accountCode,
    account_name: a.accountName,
    amount_pkr: round2(amount),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
