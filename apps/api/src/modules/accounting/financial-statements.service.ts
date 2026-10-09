import type { PrismaClient } from '@coldchain/db';
import {
  DEPRECIATION_EXPENSE_ACCOUNTS,
  SYSTEM_ACCOUNTS,
  dayBefore,
  fiscalYearStart,
  fromIsoDate,
  moneyEquals,
  round2,
  sumMoney,
  toIsoDate,
  type BalanceSheetQueryType,
  type ChangesInEquityQueryType,
  type ProfitLossQueryType,
} from '@coldchain/shared';
import { resolveFacilitySettings } from '../facility/facility.service';
import { accountBalances, classify, postedLinesWhere, type ClassifiableAccount, type Sums } from './ledger';
import { equityRoles, OWNER_MOVEMENT_SOURCES, type EquityAccountRole } from './equity-accounts';
import { sliceByRatio, divideByWeight, type RatioWindow } from './equity-allocation';

/**
 * The trial balance's siblings: profit or loss, the balance sheet and the
 * statement of changes in equity, all read through the ledger kernel (docs/25
 * L-16). Balances come from `accountBalances`, sections from `classify`, the
 * result from `resultFor` — one of each, where there used to be a hand-built
 * aggregation per statement, three section lookups and two definitions of profit
 * that drifted by a paisa (L-17, L-18).
 */

type Book = 'PACCI' | 'KATCHI';
type SumMap = Map<string, Sums>;

type ChartAccount = ClassifiableAccount & { accountName: string; normalBalance: 'DEBIT' | 'CREDIT' };

interface StatementLine {
  account_code: string;
  account_name: string;
  amount_pkr: number;
}
interface StatementGroup {
  code: string;
  name: string;
  lines: StatementLine[];
  subtotal_pkr: number;
}
type EquityLine = StatementLine & EquityAccountRole;

const PL_CLASSES = new Set(['REVENUE', 'COST_OF_SERVICE', 'EXPENSE']);
const CREDIT_SECTIONS = new Set(['REVENUE', 'OTHER_INCOME', 'CURRENT_LIABILITY', 'NON_CURRENT_LIABILITY', 'EQUITY']);
const RE = SYSTEM_ACCOUNTS.RETAINED_EARNINGS;
const CYR = SYSTEM_ACCOUNTS.CURRENT_YEAR_RESULT;

/**
 * The result over a window: credits less debits across every P&L-class detail
 * account. The ONE definition — the P&L's bottom line, the balance sheet's
 * current-year and prior-year result, the changes-in-equity result and every
 * partner's share all come from here.
 */
export function resultFor(chart: ChartAccount[], sums: SumMap): number {
  let net = 0;
  for (const a of chart) {
    if (a.accountType !== 'DETAIL' || !PL_CLASSES.has(a.accountClass)) continue;
    const s = sums.get(a.accountCode);
    if (s) net += s.credit - s.debit;
  }
  return round2(net);
}

const creditBalance = (sums: SumMap, code: string) => {
  const s = sums.get(code);
  return s ? round2(s.credit - s.debit) : 0;
};

/** One chart, classified once, for every statement a request builds. */
class ClassifiedChart {
  readonly byCode: Map<string, ChartAccount>;
  private readonly sectionOf: Map<string, string>;

  constructor(readonly accounts: ChartAccount[]) {
    this.byCode = new Map(accounts.map((a) => [a.accountCode, a]));
    this.sectionOf = new Map(accounts.map((a) => [a.accountCode, classify(a, this.byCode).section]));
  }

  section(code: string): string {
    return this.sectionOf.get(code)!;
  }

  /** Detail accounts in one statement section, by code. */
  details(section: string, cls?: string): ChartAccount[] {
    return this.accounts.filter(
      (a) => a.accountType === 'DETAIL' && this.section(a.accountCode) === section && (!cls || a.accountClass === cls),
    );
  }

  /**
   * An account's amount as its section presents it: credit-side sections show
   * credits less debits, debit-side sections the reverse — so a contra account
   * (accumulated depreciation, discounts allowed) is negative within its section.
   */
  amount(a: ChartAccount, sums: SumMap): number {
    const s = sums.get(a.accountCode);
    if (!s) return 0;
    return round2(CREDIT_SECTIONS.has(this.section(a.accountCode)) ? s.credit - s.debit : s.debit - s.credit);
  }

  lines(accounts: ChartAccount[], sums: SumMap): StatementLine[] {
    return accounts
      .map((a) => ({ account_code: a.accountCode, account_name: a.accountName, amount_pkr: this.amount(a, sums) }))
      .filter((l) => l.amount_pkr !== 0);
  }

  /** A section's lines grouped under their header, headers in code order. */
  groups(section: string, sums: SumMap): StatementGroup[] {
    const byHeader = new Map<string, ChartAccount[]>();
    for (const a of this.details(section)) {
      const list = byHeader.get(a.parentAccountCode!) ?? [];
      list.push(a);
      byHeader.set(a.parentAccountCode!, list);
    }
    return [...byHeader.keys()]
      .sort()
      .map((code) => {
        const lines = this.lines(byHeader.get(code)!, sums);
        return { code, name: this.byCode.get(code)!.accountName, lines, subtotal_pkr: sumLines(lines) };
      })
      .filter((g) => g.lines.length > 0);
  }
}

function sumLines(lines: StatementLine[]): number {
  return sumMoney(lines.map((l) => l.amount_pkr));
}
function sumGroups(groups: StatementGroup[]): number {
  return sumMoney(groups.map((g) => g.subtotal_pkr));
}

/**
 * Equity at one date, with retained earnings and the current-year result
 * computed rather than posted (virtual closing).
 *
 * `all` is every posting up to the date; `fy` the fiscal-year window whose result
 * counts as "current year". Anything posted to the two derived accounts is kept:
 * 3020 from opening balances, 3030 from before the engine refused it — a posted
 * 3030 balance is result closed out by hand, so it belongs to the year it was
 * posted in (docs/25 L-02).
 */
function equityPosition(
  chart: ClassifiedChart,
  roleOf: (code: string) => EquityAccountRole,
  all: SumMap,
  fy: SumMap,
) {
  const equity_lines: EquityLine[] = chart.accounts
    .filter((a) => a.accountClass === 'EQUITY' && a.accountType === 'DETAIL' && a.accountCode !== RE && a.accountCode !== CYR)
    .map((a) => ({
      account_code: a.accountCode,
      account_name: a.accountName,
      amount_pkr: creditBalance(all, a.accountCode),
      ...roleOf(a.accountCode),
    }))
    .filter((l) => l.amount_pkr !== 0);

  const current_year_pl_pkr = round2(resultFor(chart.accounts, fy) + creditBalance(fy, CYR));
  const prior_years_pl_pkr = round2(
    resultFor(chart.accounts, all) - resultFor(chart.accounts, fy) + creditBalance(all, CYR) - creditBalance(fy, CYR),
  );
  const retained_earnings_pkr = round2(creditBalance(all, RE) + prior_years_pl_pkr);
  const total_equity_pkr = round2(sumLines(equity_lines) + retained_earnings_pkr + current_year_pl_pkr);

  return {
    equity_lines,
    current_year_pl_pkr,
    prior_years_pl_pkr,
    retained_earnings_pkr,
    total_equity_pkr,
    // Part of the equity above, singled out: the plug belongs to no owner, so
    // anything left in it is opening equity nobody has attributed yet.
    unattributed_opening_equity_pkr: creditBalance(all, SYSTEM_ACCOUNTS.OPENING_BALANCE_EQUITY),
  };
}

export class FinancialStatementsService {
  constructor(private prisma: PrismaClient) {}

  private async chart(facilityId: string): Promise<ClassifiedChart> {
    const rows = await this.prisma.chartOfAccounts.findMany({
      where: { facilityId },
      orderBy: { accountCode: 'asc' },
      select: {
        accountCode: true,
        accountName: true,
        accountClass: true,
        accountType: true,
        parentAccountCode: true,
        normalBalance: true,
        statementSection: true,
        isCashEquivalent: true,
      },
    });
    return new ClassifiedChart(rows);
  }

  private async fyStartMonth(facilityId: string): Promise<number> {
    const facility = await this.prisma.facility.findUniqueOrThrow({
      where: { id: facilityId },
      select: { settings: true },
    });
    return resolveFacilitySettings(facility.settings).fiscal_year_start_month;
  }

  private async roles(facilityId: string) {
    return equityRoles(
      await this.prisma.partner.findMany({
        where: { facilityId },
        select: { id: true, name: true, capitalAccountCode: true, drawingsAccountCode: true },
      }),
    );
  }

  /**
   * Profit & Loss over [date_from, date_to], presented IFRS-style:
   *   Operating revenue (by stream) − Contra revenue = Net revenue
   *   − Cost of service = Gross profit
   *   − Operating expenses = Operating profit (EBIT)
   *   + Other income − Other expense = Net profit
   *   EBITDA = Operating profit + depreciation/amortisation + impairment
   *
   * The owners' equity movements are the statement of changes in equity's job,
   * not this one's (docs/25 L-24).
   */
  async getProfitLoss(facilityId: string, query: ProfitLossQueryType & { book_type: Book }) {
    const [chart, sums] = await Promise.all([
      this.chart(facilityId),
      accountBalances(this.prisma, {
        facilityId,
        book: query.book_type,
        from: fromIsoDate(query.date_from),
        to: fromIsoDate(query.date_to),
      }),
    ]);

    const revenue_groups = chart.groups('REVENUE', sums);
    const contra_revenue_lines = chart.lines(chart.details('CONTRA_REVENUE'), sums);
    const cost_of_service_lines = chart.lines(chart.details('COST_OF_SERVICE'), sums);
    const operating_expense_lines = chart.lines(chart.details('OPERATING_EXPENSE'), sums);
    const other_income_lines = chart.lines(chart.details('OTHER_INCOME'), sums);
    const other_expense_lines = chart.lines(chart.details('OTHER_EXPENSE'), sums);

    const total_operating_revenue_pkr = sumGroups(revenue_groups);
    const total_contra_revenue_pkr = sumLines(contra_revenue_lines);
    const net_revenue_pkr = round2(total_operating_revenue_pkr - total_contra_revenue_pkr);
    const total_cost_of_service_pkr = sumLines(cost_of_service_lines);
    const gross_profit_pkr = round2(net_revenue_pkr - total_cost_of_service_pkr);
    const total_operating_expense_pkr = sumLines(operating_expense_lines);
    const operating_profit_pkr = round2(gross_profit_pkr - total_operating_expense_pkr);
    const total_other_income_pkr = sumLines(other_income_lines);
    const total_other_expense_pkr = sumLines(other_expense_lines);
    const net_profit_pkr = resultFor(chart.accounts, sums);

    // EBITDA adds back the depreciation and amortisation accounts by role, and
    // impairment on a row of its own. It used to add back every account any
    // fixed asset named as its expense account (docs/25 L-21).
    const expenseOn = (codes: readonly string[]) =>
      sumMoney(codes.map((code) => {
        const s = sums.get(code);
        return s ? s.debit - s.credit : 0;
      }));
    const depreciation_amortisation_pkr = expenseOn(DEPRECIATION_EXPENSE_ACCOUNTS);
    const impairment_pkr = expenseOn([SYSTEM_ACCOUNTS.IMPAIRMENT_LOSS]);
    const ebitda_pkr = round2(operating_profit_pkr + depreciation_amortisation_pkr + impairment_pkr);

    // A margin over zero or negative net revenue is undefined, not 0% —
    // returning 0 would read as "break-even" when the period has no revenue
    // base. null renders as "—" (phase/19 audit item 14).
    const pct = (n: number): number | null => (net_revenue_pkr > 0 ? round2((n / net_revenue_pkr) * 100) : null);

    return {
      date_from: query.date_from,
      date_to: query.date_to,

      revenue_groups,
      total_operating_revenue_pkr,
      contra_revenue_lines,
      total_contra_revenue_pkr,
      net_revenue_pkr,

      cost_of_service_lines,
      total_cost_of_service_pkr,
      gross_profit_pkr,
      gross_profit_pct: pct(gross_profit_pkr),

      operating_expense_lines,
      total_operating_expense_pkr,
      operating_profit_pkr,
      operating_profit_pct: pct(operating_profit_pkr),

      other_income_lines,
      total_other_income_pkr,

      other_expense_lines,
      total_other_expense_pkr,

      depreciation_amortisation_pkr,
      impairment_pkr,
      ebitda_pkr,
      ebitda_pct: pct(ebitda_pkr),

      net_profit_pkr,
      net_profit_pct: pct(net_profit_pkr),
    };
  }

  /**
   * Classified Balance Sheet as of `as_of_date`:
   *   Current Assets / Non-current Assets = Total Assets
   *   Current Liabilities / Non-current Liabilities = Total Liabilities
   *   Equity (each owner's accounts + the plug + Retained Earnings + Current-Year result)
   *   Assets = Liabilities + Equity
   *
   * Virtual closing (phase/19): the current-year line covers only the fiscal year
   * containing as_of_date; everything earlier is retained earnings. No closing
   * entry is posted — the ledger is immutable — so the split is presented.
   */
  async getBalanceSheet(facilityId: string, query: BalanceSheetQueryType & { book_type: Book }) {
    const asOf = fromIsoDate(query.as_of_date);
    const fyStart = fiscalYearStart(asOf, await this.fyStartMonth(facilityId));
    const [chart, roleOf, sums, fySums] = await Promise.all([
      this.chart(facilityId),
      this.roles(facilityId),
      accountBalances(this.prisma, { facilityId, book: query.book_type, to: asOf }),
      accountBalances(this.prisma, { facilityId, book: query.book_type, from: fyStart, to: asOf }),
    ]);

    const current_asset_groups = chart.groups('CURRENT_ASSET', sums);
    const non_current_asset_groups = chart.groups('NON_CURRENT_ASSET', sums);
    const current_liability_groups = chart.groups('CURRENT_LIABILITY', sums);
    const non_current_liability_groups = chart.groups('NON_CURRENT_LIABILITY', sums);
    const total_current_assets_pkr = sumGroups(current_asset_groups);
    const total_non_current_assets_pkr = sumGroups(non_current_asset_groups);
    const total_current_liabilities_pkr = sumGroups(current_liability_groups);
    const total_non_current_liabilities_pkr = sumGroups(non_current_liability_groups);

    const total_assets_pkr = round2(total_current_assets_pkr + total_non_current_assets_pkr);
    const total_liabilities_pkr = round2(total_current_liabilities_pkr + total_non_current_liabilities_pkr);

    const equity = equityPosition(chart, roleOf, sums, fySums);
    const total_liabilities_and_equity_pkr = round2(total_liabilities_pkr + equity.total_equity_pkr);

    // Cash and cash equivalents (IFRS for SMEs 7.2): what the chart flags as
    // cash, not the Cash & Bank header — which also holds 1025 Cheques in Hand,
    // money that can still bounce. The cash-flow statement closes on this.
    const cash_and_cash_equivalents_pkr = sumMoney(
      chart.accounts.filter((a) => a.isCashEquivalent).map((a) => chart.amount(a, sums)),
    );

    return {
      as_of_date: query.as_of_date,
      cash_and_cash_equivalents_pkr,

      current_asset_groups,
      total_current_assets_pkr,
      non_current_asset_groups,
      total_non_current_assets_pkr,
      total_assets_pkr,

      current_liability_groups,
      total_current_liabilities_pkr,
      non_current_liability_groups,
      total_non_current_liabilities_pkr,
      total_liabilities_pkr,

      ...equity,
      fiscal_year_start: toIsoDate(fyStart),
      total_liabilities_and_equity_pkr,

      is_balanced: moneyEquals(total_assets_pkr, total_liabilities_and_equity_pkr),
    };
  }

  /**
   * Statement of changes in equity (IFRS for SMEs 6.2/6.3) — the one equity
   * roll-forward (docs/25 L-24).
   *
   * One column per category of equity, as 4.13 requires of an entity without
   * share capital: each partner's capital and drawings accounts (named by the
   * partners table, never inferred), the opening-balance plug, any other equity
   * account, retained earnings and the current-year result.
   *
   * Rows: opening · capital introduced · drawings · other movements · result ·
   * transfer · closing. Capital introduced and drawings are owner-equity
   * documents on a partner's own accounts; an opening balance, attributing the
   * plug or a manual correction is an "other movement". The result lands only on
   * the current-year column, and when the range crosses a fiscal-year end the
   * finished year's result moves to retained earnings on the transfer row, which
   * nets to zero across the two. Opening equity is split as at the START of
   * date_from, so a range starting on the fiscal-year start opens with last
   * year's result already in retained earnings.
   */
  async getChangesInEquity(facilityId: string, query: ChangesInEquityQueryType & { book_type: Book }) {
    const book = query.book_type;
    const from = fromIsoDate(query.date_from);
    const to = fromIsoDate(query.date_to);
    const openingDate = fromIsoDate(dayBefore(query.date_from));
    const fyMonth = await this.fyStartMonth(facilityId);

    const ownerWhere = postedLinesWhere({ facilityId, book, from, to });
    const [chart, roleOf, openAll, openFy, closeAll, closeFy, period, ownerRows, bs] = await Promise.all([
      this.chart(facilityId),
      this.roles(facilityId),
      accountBalances(this.prisma, { facilityId, book, to: openingDate }),
      accountBalances(this.prisma, { facilityId, book, from: fiscalYearStart(from, fyMonth), to: openingDate }),
      accountBalances(this.prisma, { facilityId, book, to }),
      accountBalances(this.prisma, { facilityId, book, from: fiscalYearStart(to, fyMonth), to }),
      accountBalances(this.prisma, { facilityId, book, from, to }),
      this.prisma.journalEntryLine.groupBy({
        by: ['accountCode'],
        where: {
          ...ownerWhere,
          journalEntry: { ...(ownerWhere.journalEntry as object), sourceTable: { in: OWNER_MOVEMENT_SOURCES } },
        },
        _sum: { debitAmount: true, creditAmount: true },
      }),
      this.getBalanceSheet(facilityId, { as_of_date: query.date_to, book_type: book }),
    ]);
    const ownerMoved = new Map(
      ownerRows.map((r) => [r.accountCode, round2(Number(r._sum.creditAmount ?? 0) - Number(r._sum.debitAmount ?? 0))]),
    );

    const open = equityPosition(chart, roleOf, openAll, openFy);
    const close = equityPosition(chart, roleOf, closeAll, closeFy);

    const columns = chart.accounts
      .filter((a) => a.accountClass === 'EQUITY' && a.accountType === 'DETAIL' && a.accountCode !== RE && a.accountCode !== CYR)
      .map((a) => {
        const role = roleOf(a.accountCode);
        const movement = creditBalance(period, a.accountCode);
        const owner = role.role === 'PARTNER_CAPITAL' || role.role === 'PARTNER_DRAWINGS' ? (ownerMoved.get(a.accountCode) ?? 0) : 0;
        const opening_pkr = creditBalance(openAll, a.accountCode);
        return {
          account_code: a.accountCode,
          account_name: a.accountName,
          ...role,
          opening_pkr,
          capital_introduced_pkr: role.role === 'PARTNER_CAPITAL' ? owner : 0,
          drawings_pkr: role.role === 'PARTNER_DRAWINGS' ? owner : 0,
          other_movements_pkr: round2(movement - owner),
          result_pkr: 0,
          transfer_pkr: 0,
          closing_pkr: round2(opening_pkr + movement),
        };
      })
      // An account that never moved and carries nothing is noise on the face of
      // a statement; one that moved to zero is not, and stays.
      .filter((c) => c.opening_pkr !== 0 || c.closing_pkr !== 0 || c.capital_introduced_pkr !== 0 || c.drawings_pkr !== 0 || c.other_movements_pkr !== 0);

    // The two computed columns. Their transfers are each other's negative by
    // construction: RE + current year = posted 3020 + posted 3030 + all-time result.
    const periodResult = resultFor(chart.accounts, period);
    const cyOther = creditBalance(period, CYR);
    const cyTransfer = round2(close.current_year_pl_pkr - open.current_year_pl_pkr - periodResult - cyOther);
    const derived = (code: string, role: EquityAccountRole, opening: number, other: number, result: number, transfer: number, closing: number) => ({
      account_code: code,
      account_name: chart.byCode.get(code)!.accountName,
      ...role,
      opening_pkr: opening,
      capital_introduced_pkr: 0,
      drawings_pkr: 0,
      other_movements_pkr: other,
      result_pkr: result,
      transfer_pkr: transfer,
      closing_pkr: closing,
    });
    const allColumns = [
      ...columns,
      derived(RE, roleOf(RE), open.retained_earnings_pkr, creditBalance(period, RE), 0, round2(-cyTransfer), close.retained_earnings_pkr),
      derived(CYR, roleOf(CYR), open.current_year_pl_pkr, cyOther, periodResult, cyTransfer, close.current_year_pl_pkr),
    ];

    const sum = (pick: (c: (typeof allColumns)[number]) => number) => sumMoney(allColumns.map(pick));
    const total_closing_pkr = sum((c) => c.closing_pkr);

    return {
      date_from: query.date_from,
      date_to: query.date_to,
      columns: allColumns,
      total_opening_pkr: sum((c) => c.opening_pkr),
      total_capital_introduced_pkr: sum((c) => c.capital_introduced_pkr),
      total_drawings_pkr: sum((c) => c.drawings_pkr),
      total_other_movements_pkr: sum((c) => c.other_movements_pkr),
      total_result_pkr: sum((c) => c.result_pkr),
      total_closing_pkr,
      // Closing equity here and on the balance sheet at date_to are computed by
      // separate requests over separate windows; they must agree.
      is_reconciled: moneyEquals(total_closing_pkr, bs.total_equity_pkr),
      ...(await this.allocateResult(facilityId, query, chart)),
    };
  }

  /**
   * Each owner's share of the period's result, or null where no ratio has ever
   * been agreed.
   *
   * Disclosed beside the columns rather than folded into them — see
   * equity-allocation.ts for why. Nothing here posts, and nothing here changes
   * total equity: it says whose the result is, it does not move it.
   */
  private async allocateResult(
    facilityId: string,
    query: ChangesInEquityQueryType & { book_type: Book },
    chart: ClassifiedChart,
  ) {
    const rows = await this.prisma.partnerProfitShare.findMany({
      where: { facilityId },
      orderBy: { effectiveFrom: 'asc' },
      include: { partner: { select: { id: true, name: true, capitalAccountCode: true } } },
    });
    if (rows.length === 0) return { result_allocation: null, result_is_unallocated: true };

    const byDate = new Map<string, RatioWindow>();
    for (const r of rows) {
      const key = toIsoDate(r.effectiveFrom);
      const window = byDate.get(key) ?? { effective_from: key, shares: [] };
      window.shares.push({
        partner_id: r.partner.id,
        partner_name: r.partner.name,
        capital_account_code: r.partner.capitalAccountCode,
        weight: Number(r.weight),
      });
      byDate.set(key, window);
    }

    const retirements = (
      await this.prisma.partner.findMany({
        where: { facilityId, retiredOn: { not: null } },
        select: { id: true, retiredOn: true },
      })
    ).map((p) => ({ partner_id: p.id, retired_on: toIsoDate(p.retiredOn!) }));
    const slices = sliceByRatio(query.date_from, query.date_to, [...byDate.values()], retirements);
    const totals = new Map<string, { name: string; code: string; amount: number }>();
    let unallocated = 0;
    const windows: { from: string; to: string; result_pkr: number; ratio_from: string | null }[] = [];

    for (const slice of slices) {
      // The result earned inside this slice alone. Ratio changes are rare, so
      // this is a handful of queries at most.
      const result = resultFor(
        chart.accounts,
        await accountBalances(this.prisma, {
          facilityId,
          book: query.book_type,
          from: fromIsoDate(slice.from),
          to: fromIsoDate(slice.to),
        }),
      );
      windows.push({ from: slice.from, to: slice.to, result_pkr: result, ratio_from: slice.ratio?.effective_from ?? null });

      if (!slice.ratio) {
        unallocated = round2(unallocated + result);
        continue;
      }
      for (const part of divideByWeight(result, slice.ratio.shares)) {
        const share = slice.ratio.shares.find((x) => x.partner_id === part.partner_id)!;
        const running = totals.get(part.partner_id) ?? { name: share.partner_name, code: share.capital_account_code, amount: 0 };
        running.amount = round2(running.amount + part.amount_pkr);
        totals.set(part.partner_id, running);
      }
    }

    return {
      result_allocation: {
        by_partner: [...totals.entries()].map(([partner_id, v]) => ({
          partner_id,
          partner_name: v.name,
          capital_account_code: v.code,
          amount_pkr: v.amount,
        })),
        unallocated_pkr: unallocated,
        windows,
      },
      // True while any part of the period's result belongs to nobody in
      // particular — a ratio that starts mid-period.
      result_is_unallocated: unallocated !== 0,
    };
  }
}
