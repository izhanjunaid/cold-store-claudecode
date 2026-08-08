import type { PrismaClient, Prisma } from '@coldchain/db';
import type { ProfitLossQueryType, BalanceSheetQueryType } from '@coldchain/shared';
import { resolveFacilitySettings } from '../facility/facility.service';
import { fiscalYearStart } from './fiscal-year';

type Sums = { debit: number; credit: number };
type SumMap = Map<string, Sums>;
type Account = { accountCode: string; accountName: string; accountClass: string; accountType: string; parentAccountCode: string | null; normalBalance: 'DEBIT' | 'CREDIT' };

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

// Depreciation & amortisation accounts (for EBITDA add-back)
const DA_CODES = new Set(['5040', '6120', '6130', '6140']);

export class FinancialStatementsService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Profit & Loss over [date_from, date_to], presented IFRS-style:
   *   Operating revenue (by stream) − Contra revenue = Net revenue
   *   − Cost of service = Gross profit
   *   − Operating expenses = Operating profit (EBIT)
   *   + Other income = Net profit
   *   EBITDA = Operating profit + depreciation/amortisation
   *
   * Every stage folds in unclassified accounts of the matching class (F-6b) —
   * accountClass maps 1:1 onto a P&L subtotal, so there is no judgement call
   * in placing them, unlike the balance sheet's current/non-current split.
   */
  async getProfitLoss(facilityId: string, query: ProfitLossQueryType) {
    const lines = await this.fetchLines(facilityId, query.date_from, query.date_to, query.book_type);
    const accounts = await this.loadAccounts(facilityId);
    const sums = aggregate(lines);

    const credit = (s: Sums) => s.credit - s.debit;
    const debit = (s: Sums) => s.debit - s.credit;

    // Operating revenue streams: header 4000 (Storage), 4100 (Handling/Service)
    const revenue_groups = buildGroups(accounts, sums, ['4000', '4100'], credit);

    // Contra revenue (Discounts Allowed, header 4900) — presented as a deduction
    const contra_revenue_lines = buildLines(accounts, sums, ['4900'], debit);
    const total_contra_revenue_pkr = sumLines(contra_revenue_lines);

    // Cost of service (header 5000)
    const cost_of_service_lines = buildLines(accounts, sums, ['5000'], debit);

    // Operating expenses (header 6000)
    const operating_expense_lines = buildLines(accounts, sums, ['6000'], debit);

    // Other income (header 4200), below the line
    const other_income_lines = buildLines(accounts, sums, ['4200'], credit);
    const total_other_income_pkr = sumLines(other_income_lines);

    // Completeness (F-6b): any P&L-class DETAIL account with activity that the
    // hardcoded header rollups above did not place would otherwise silently
    // drop out of every subtotal (while remaining in the trial balance).
    // Unlike the balance sheet's current/non-current split, there is no
    // judgement call here — accountClass maps 1:1 onto a P&L subtotal, so an
    // unclassified account is folded straight into the total its class
    // belongs to, not just tacked onto the bottom line. Pre-phase-24 this
    // only reached net_profit_pkr, which left operating_profit_pkr,
    // ebitda_pkr and every margin percentage wrong under a reachable
    // condition — net_profit_pkr was the one figure that was already right.
    const placed = new Set<string>();
    for (const g of revenue_groups) for (const l of g.lines) placed.add(l.account_code);
    for (const l of contra_revenue_lines) placed.add(l.account_code);
    for (const l of cost_of_service_lines) placed.add(l.account_code);
    for (const l of operating_expense_lines) placed.add(l.account_code);
    for (const l of other_income_lines) placed.add(l.account_code);

    const unclassified_lines: StatementLine[] = [];
    let unclassifiedRevenuePkr = 0; // additional revenue
    let unclassifiedCostOfServicePkr = 0; // additional cost (positive magnitude)
    let unclassifiedExpensePkr = 0; // additional expense (positive magnitude)
    for (const a of accounts) {
      if (a.accountType !== 'DETAIL' || placed.has(a.accountCode)) continue;
      if (a.accountClass !== 'REVENUE' && a.accountClass !== 'COST_OF_SERVICE' && a.accountClass !== 'EXPENSE') continue;
      const s = sums.get(a.accountCode);
      if (!s) continue;
      if (a.accountClass === 'REVENUE') {
        const amt = round2(credit(s));
        if (amt === 0) continue;
        unclassified_lines.push({ account_code: a.accountCode, account_name: a.accountName, amount_pkr: amt });
        unclassifiedRevenuePkr += amt;
      } else {
        const magnitude = round2(debit(s));
        if (magnitude === 0) continue;
        // Signed as its contribution to net profit — a cost/expense reduces it.
        unclassified_lines.push({ account_code: a.accountCode, account_name: a.accountName, amount_pkr: -magnitude });
        if (a.accountClass === 'COST_OF_SERVICE') unclassifiedCostOfServicePkr += magnitude;
        else unclassifiedExpensePkr += magnitude;
      }
    }
    const total_unclassified_pkr = round2(unclassified_lines.reduce((s, l) => s + l.amount_pkr, 0));

    // Every subtotal below now includes its unclassified share, so the chain
    // of identities (net_revenue = revenue − contra, gross = net_revenue −
    // COGS, operating = gross − opex, net = operating + other income) holds
    // exactly whether or not any account is unclassified.
    const total_operating_revenue_pkr = round2(sumGroups(revenue_groups) + unclassifiedRevenuePkr);
    const net_revenue_pkr = round2(total_operating_revenue_pkr - total_contra_revenue_pkr);

    const total_cost_of_service_pkr = round2(sumLines(cost_of_service_lines) + unclassifiedCostOfServicePkr);
    const gross_profit_pkr = round2(net_revenue_pkr - total_cost_of_service_pkr);

    const total_operating_expense_pkr = round2(sumLines(operating_expense_lines) + unclassifiedExpensePkr);
    const operating_profit_pkr = round2(gross_profit_pkr - total_operating_expense_pkr);

    const net_profit_pkr = round2(operating_profit_pkr + total_other_income_pkr);

    // Depreciation & amortisation add-back for EBITDA
    let da = 0;
    for (const a of accounts) {
      if (DA_CODES.has(a.accountCode)) {
        const s = sums.get(a.accountCode);
        if (s) da += debit(s);
      }
    }
    const depreciation_amortisation_pkr = round2(da);
    const ebitda_pkr = round2(operating_profit_pkr + depreciation_amortisation_pkr);

    // A margin over zero or negative net revenue is undefined, not 0% —
    // returning 0 would read as "break-even" when the period actually has no
    // revenue base. null renders as "—" in the UI (phase/19 audit item 14).
    const pct = (n: number): number | null =>
      net_revenue_pkr > 0 ? round2((n / net_revenue_pkr) * 100) : null;

    // Flat arrays retained for CSV / back-compat
    const revenue_lines = [...revenue_groups.flatMap((g) => g.lines), ...other_income_lines];

    return {
      date_from: query.date_from,
      date_to: query.date_to,

      revenue_groups,
      total_operating_revenue_pkr,
      contra_revenue_lines,
      total_contra_revenue_pkr: round2(total_contra_revenue_pkr),
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
      total_other_income_pkr: round2(total_other_income_pkr),

      depreciation_amortisation_pkr,
      ebitda_pkr,
      ebitda_pct: pct(ebitda_pkr),

      net_profit_pkr,
      net_profit_pct: pct(net_profit_pkr),

      unclassified_lines,
      total_unclassified_pkr,
      has_unclassified: unclassified_lines.length > 0,

      // Back-compat flat fields (older clients / existing tests)
      revenue_lines,
      total_revenue_pkr: net_revenue_pkr,
      expense_lines: operating_expense_lines,
      total_expense_pkr: total_operating_expense_pkr,
    };
  }

  /**
   * Classified Balance Sheet as of `as_of_date`:
   *   Current Assets / Non-current Assets = Total Assets
   *   Current Liabilities / Non-current Liabilities = Total Liabilities
   *   Equity (Capital + Retained Earnings + Current-Year P&L)
   *   Assets = Liabilities + Equity
   */
  async getBalanceSheet(facilityId: string, query: BalanceSheetQueryType) {
    const lines = await this.fetchLines(facilityId, undefined, query.as_of_date, query.book_type);
    const accounts = await this.loadAccounts(facilityId);
    const sums = aggregate(lines);

    // Virtual closing (phase/19 audit): the "Current Year Profit/(Loss)" line
    // must cover only the fiscal year containing as_of_date. Everything earlier
    // is prior-period result and belongs in retained earnings — no closing JE
    // is posted (that would violate the ledger-immutability guards), so we
    // present it. `sums` above spans all postings up to as_of (used for
    // all-time P&L); a second window gives the current-FY slice.
    const facility = await this.prisma.facility.findUniqueOrThrow({
      where: { id: facilityId },
      select: { settings: true },
    });
    const fyStartMonth = resolveFacilitySettings(facility.settings).fiscal_year_start_month;
    const fyStart = fiscalYearStart(new Date(query.as_of_date), fyStartMonth);
    const fyStartIso = fyStart.toISOString().slice(0, 10);
    const fyLines = await this.fetchLines(facilityId, fyStartIso, query.as_of_date, query.book_type);
    const fySums = aggregate(fyLines);

    const assetAmt = (s: Sums) => s.debit - s.credit; // contra (accum deprec) naturally negative → net book value
    const crAmt = (s: Sums) => s.credit - s.debit;

    // Assets
    const current_asset_groups = buildGroups(accounts, sums, ['1000', '1100', '1200'], assetAmt);
    const total_current_assets_pkr = round2(sumGroups(current_asset_groups));
    const non_current_asset_groups = buildGroups(accounts, sums, ['1300'], assetAmt);
    const total_non_current_assets_pkr = round2(sumGroups(non_current_asset_groups));

    // Liabilities
    const current_liability_groups = buildGroups(accounts, sums, ['2000'], crAmt);
    const total_current_liabilities_pkr = round2(sumGroups(current_liability_groups));
    const non_current_liability_groups = buildGroups(accounts, sums, ['2100'], crAmt);
    const total_non_current_liabilities_pkr = round2(sumGroups(non_current_liability_groups));

    // Completeness (F-6b): asset/liability DETAIL accounts the hardcoded
    // header rollups did not place. The equity side already aggregates by
    // class, so surfacing these keeps the sheet complete AND balanced.
    const placedBs = new Set<string>();
    for (const g of [...current_asset_groups, ...non_current_asset_groups]) for (const l of g.lines) placedBs.add(l.account_code);
    for (const g of [...current_liability_groups, ...non_current_liability_groups]) for (const l of g.lines) placedBs.add(l.account_code);

    const unclassified_asset_lines: StatementLine[] = [];
    const unclassified_liability_lines: StatementLine[] = [];
    for (const a of accounts) {
      if (a.accountType !== 'DETAIL' || placedBs.has(a.accountCode)) continue;
      const s = sums.get(a.accountCode);
      if (!s) continue;
      if (a.accountClass === 'ASSET') {
        const amt = round2(assetAmt(s));
        if (amt !== 0) unclassified_asset_lines.push({ account_code: a.accountCode, account_name: a.accountName, amount_pkr: amt });
      } else if (a.accountClass === 'LIABILITY') {
        const amt = round2(crAmt(s));
        if (amt !== 0) unclassified_liability_lines.push({ account_code: a.accountCode, account_name: a.accountName, amount_pkr: amt });
      }
    }

    const total_assets_pkr = round2(
      total_current_assets_pkr + total_non_current_assets_pkr + sumLines(unclassified_asset_lines),
    );
    const total_liabilities_pkr = round2(
      total_current_liabilities_pkr + total_non_current_liabilities_pkr + sumLines(unclassified_liability_lines),
    );

    // Equity — Capital (3010) and other equity detail accounts. Exclude BOTH
    // 3020 Retained Earnings (folded into retained_earnings_pkr below) and 3030
    // Current Year P&L (never posted; computed live).
    const equity_lines = accounts
      .filter(
        (a) =>
          a.accountClass === 'EQUITY' &&
          a.accountType === 'DETAIL' &&
          a.accountCode !== '3020' &&
          a.accountCode !== '3030',
      )
      .map((a) => line(a, sums, crAmt))
      .filter((l) => l.amount_pkr !== 0);

    // P&L-class net result over a given window (revenue − cost − expense).
    const plNet = (window: SumMap): number => {
      let net = 0;
      for (const a of accounts) {
        if (a.accountType !== 'DETAIL') continue;
        const s = window.get(a.accountCode);
        if (!s) continue;
        if (a.accountClass === 'REVENUE') net += s.credit - s.debit;
        else if (a.accountClass === 'COST_OF_SERVICE') net -= s.debit - s.credit;
        else if (a.accountClass === 'EXPENSE') net -= s.debit - s.credit;
      }
      return net;
    };

    // Current-year P&L = current fiscal-year window; prior years = all-time
    // (up to as_of) minus current year. Retained earnings merges the posted
    // 3020 balance (today only touched by opening balances) with that
    // accumulated prior-year result. This keeps the identity exact:
    //   retained + current = posted-3020 + all-time-P&L
    // which is precisely what the old single "current_year_pl" line summed.
    const current_year_pl_pkr = round2(plNet(fySums));
    const allTimePL = plNet(sums);
    const prior_years_pl_pkr = round2(allTimePL - plNet(fySums));
    const posted3020 = sums.get('3020');
    const retained_earnings_pkr = round2((posted3020 ? crAmt(posted3020) : 0) + prior_years_pl_pkr);

    const total_equity_pkr = round2(sumLines(equity_lines) + retained_earnings_pkr + current_year_pl_pkr);
    const total_liabilities_and_equity_pkr = round2(total_liabilities_pkr + total_equity_pkr);

    return {
      as_of_date: query.as_of_date,

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

      equity_lines,
      retained_earnings_pkr,
      prior_years_pl_pkr,
      current_year_pl_pkr,
      fiscal_year_start: fyStartIso,
      total_equity_pkr,
      total_liabilities_and_equity_pkr,

      unclassified_asset_lines,
      unclassified_liability_lines,
      has_unclassified: unclassified_asset_lines.length > 0 || unclassified_liability_lines.length > 0,

      is_balanced: Math.abs(total_assets_pkr - total_liabilities_and_equity_pkr) < 0.01,

      // Back-compat flat fields
      asset_lines: [...current_asset_groups, ...non_current_asset_groups].flatMap((g) => g.lines),
      liability_lines: [...current_liability_groups, ...non_current_liability_groups].flatMap((g) => g.lines),
    };
  }

  private async loadAccounts(facilityId: string): Promise<Account[]> {
    return this.prisma.chartOfAccounts.findMany({
      where: { facilityId },
      orderBy: { accountCode: 'asc' },
      select: { accountCode: true, accountName: true, accountClass: true, accountType: true, parentAccountCode: true, normalBalance: true },
    }) as unknown as Promise<Account[]>;
  }

  private async fetchLines(facilityId: string, dateFrom: string | undefined, dateTo: string | undefined, bookType?: string) {
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
          ...(bookType ? { bookType: bookType as Prisma.JournalEntryWhereInput['bookType'] } : {}),
          ...(dateClause ? { entryDate: dateClause } : {}),
        },
      },
      select: { accountCode: true, debitAmount: true, creditAmount: true },
    });
  }
}

function aggregate(lines: { accountCode: string; debitAmount: unknown; creditAmount: unknown }[]): SumMap {
  const m: SumMap = new Map();
  for (const l of lines) {
    const cur = m.get(l.accountCode) ?? { debit: 0, credit: 0 };
    cur.debit += Number(l.debitAmount);
    cur.credit += Number(l.creditAmount);
    m.set(l.accountCode, cur);
  }
  return m;
}

/** One statement line for a detail account, amount via `amt`. */
function line(a: Account, sums: SumMap, amt: (s: Sums) => number): StatementLine {
  const s = sums.get(a.accountCode);
  return { account_code: a.accountCode, account_name: a.accountName, amount_pkr: round2(s ? amt(s) : 0) };
}

/** Detail lines under one or more header codes (flattened, non-zero only). */
function buildLines(accounts: Account[], sums: SumMap, headerCodes: string[], amt: (s: Sums) => number): StatementLine[] {
  const headers = new Set(headerCodes);
  return accounts
    .filter((a) => a.accountType === 'DETAIL' && a.parentAccountCode !== null && headers.has(a.parentAccountCode))
    .map((a) => line(a, sums, amt))
    .filter((l) => l.amount_pkr !== 0);
}

/** Nested groups (one per header code) with subtotals. */
function buildGroups(accounts: Account[], sums: SumMap, headerCodes: string[], amt: (s: Sums) => number): StatementGroup[] {
  const groups: StatementGroup[] = [];
  for (const code of headerCodes) {
    const header = accounts.find((a) => a.accountCode === code);
    const lines = accounts
      .filter((a) => a.accountType === 'DETAIL' && a.parentAccountCode === code)
      .map((a) => line(a, sums, amt))
      .filter((l) => l.amount_pkr !== 0);
    if (lines.length === 0) continue;
    groups.push({
      code,
      name: header?.accountName ?? code,
      lines,
      subtotal_pkr: round2(sumLines(lines)),
    });
  }
  return groups;
}

function sumLines(lines: StatementLine[]): number {
  return round2(lines.reduce((s, l) => s + l.amount_pkr, 0));
}
function sumGroups(groups: StatementGroup[]): number {
  return round2(groups.reduce((s, g) => s + g.subtotal_pkr, 0));
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
