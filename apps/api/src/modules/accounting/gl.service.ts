import type { PrismaClient } from '@coldchain/db';
import {
  ACCOUNT_CLASSES,
  CLASS_LABEL,
  SECTION_LABEL,
  dayBefore,
  fromIsoDate,
  moneyEquals,
  round2,
  toIsoDate,
  type AccountClassName,
  type GeneralLedgerQueryType,
  type TrialBalanceQueryType,
} from '@coldchain/shared';
import { Errors } from '../../common/errors';
import { accountBalances, classify, partyBalances, postedLinesWhere, signedBalance, type Sums } from './ledger';

type Book = 'PACCI' | 'KATCHI';

/**
 * The general ledger and the trial balance, read through the ledger kernel
 * (docs/25 L-16): balances from accountBalances/partyBalances, the running
 * balance signed by the account's own normal balance, sections from classify.
 */
export class GlService {
  constructor(private prisma: PrismaClient) {}

  /** General ledger for one account (optionally one party), with a running balance from the opening. */
  async getAccountLedger(facilityId: string, query: GeneralLedgerQueryType & { book_type: Book }) {
    const account = await this.prisma.chartOfAccounts.findUnique({
      where: { facilityId_accountCode: { facilityId, accountCode: query.account_code } },
    });
    if (!account) throw Errors.ACCOUNT_NOT_FOUND();

    const book = query.book_type;
    let openingSums: Sums | undefined;
    if (query.date_from) {
      const to = fromIsoDate(dayBefore(query.date_from));
      openingSums = query.party_id
        ? (await partyBalances(this.prisma, { facilityId, book, accounts: [account.accountCode], to, partyId: query.party_id })).get(query.party_id)
        : (await accountBalances(this.prisma, { facilityId, book, to, accounts: [account.accountCode] })).get(account.accountCode);
    }
    const opening = signedBalance(openingSums, account.normalBalance);

    const lines = await this.prisma.journalEntryLine.findMany({
      where: {
        ...postedLinesWhere({
          facilityId,
          book,
          from: query.date_from ? fromIsoDate(query.date_from) : undefined,
          to: query.date_to ? fromIsoDate(query.date_to) : undefined,
        }),
        accountCode: account.accountCode,
        ...(query.party_id ? { partyId: query.party_id } : {}),
      },
      include: {
        journalEntry: { select: { id: true, entryNumber: true, entryDate: true, description: true } },
        party: { select: { name: true } },
        lot: { select: { lotNumber: true } },
      },
      orderBy: [{ journalEntry: { entryDate: 'asc' } }, { journalEntry: { createdAt: 'asc' } }, { lineNumber: 'asc' }],
    });

    let balance = opening;
    let totalDebit = 0;
    let totalCredit = 0;
    const entries = lines.map((l) => {
      const d = Number(l.debitAmount);
      const c = Number(l.creditAmount);
      totalDebit += d;
      totalCredit += c;
      balance = round2(balance + signedBalance({ debit: d, credit: c }, account.normalBalance));
      return {
        date: toIsoDate(l.journalEntry.entryDate),
        entry_number: l.journalEntry.entryNumber,
        entry_id: l.journalEntry.id,
        description: l.description ?? l.journalEntry.description,
        party_name: l.party?.name ?? null,
        lot_number: l.lot?.lotNumber ?? null,
        debit_pkr: round2(d),
        credit_pkr: round2(c),
        balance_pkr: balance,
      };
    });

    return {
      account_code: account.accountCode,
      account_name: account.accountName,
      account_class: account.accountClass,
      normal_balance: account.normalBalance,
      date_from: query.date_from ?? null,
      date_to: query.date_to ?? null,
      opening_balance_pkr: opening,
      total_debit_pkr: round2(totalDebit),
      total_credit_pkr: round2(totalCredit),
      closing_balance_pkr: balance,
      entries,
    };
  }

  /**
   * Trial balance over [date_from, date_to] — professional 6-column form:
   *   Opening (Dr/Cr) · Period movement (Dr/Cr) · Closing (Dr/Cr)
   *
   * Opening = net of all postings strictly BEFORE date_from (0 if no date_from).
   * Rows are grouped twice — by account class, the conventional view, and by
   * statement section, so a subtotal can be traced onto the face of the P&L or
   * balance sheet. Both come from the same classify() the statements use.
   */
  async getTrialBalance(facilityId: string, query: TrialBalanceQueryType & { book_type: Book }) {
    const book = query.book_type;
    const date_to = query.date_to ?? toIsoDate(new Date());
    const [accounts, period, openingSums] = await Promise.all([
      this.prisma.chartOfAccounts.findMany({ where: { facilityId }, orderBy: { accountCode: 'asc' } }),
      accountBalances(this.prisma, {
        facilityId,
        book,
        from: query.date_from ? fromIsoDate(query.date_from) : undefined,
        to: fromIsoDate(date_to),
      }),
      query.date_from
        ? accountBalances(this.prisma, { facilityId, book, to: fromIsoDate(dayBefore(query.date_from)) })
        : Promise.resolve(new Map<string, Sums>()),
    ]);
    const byCode = new Map(accounts.map((a) => [a.accountCode, a]));

    const blankSub = () => ({
      opening_debit_pkr: 0,
      opening_credit_pkr: 0,
      movement_debit_pkr: 0,
      movement_credit_pkr: 0,
      debit_balance_pkr: 0,
      credit_balance_pkr: 0,
    });
    type Sub = ReturnType<typeof blankSub>;

    const groupMap = new Map<string, { account_class: string; label: string; rows: TrialBalanceRow[]; subtotal: Sub }>();
    const sectionMap = new Map<string, { statement_section: string; label: string; rows: TrialBalanceRow[]; subtotal: Sub }>();
    const totals = blankSub();

    for (const a of accounts) {
      const open = openingSums.get(a.accountCode) ?? { debit: 0, credit: 0 };
      const per = period.get(a.accountCode) ?? { debit: 0, credit: 0 };
      const openingNet = round2(open.debit - open.credit);
      const closingNet = round2(openingNet + per.debit - per.credit);
      if (openingNet === 0 && per.debit === 0 && per.credit === 0 && closingNet === 0) continue;

      const section = classify(a, byCode).section;
      const row: TrialBalanceRow = {
        account_code: a.accountCode,
        account_name: a.accountName,
        account_class: a.accountClass,
        statement_section: section,
        normal_balance: a.normalBalance,
        opening_debit_pkr: Math.max(openingNet, 0),
        opening_credit_pkr: Math.max(-openingNet, 0),
        movement_debit_pkr: per.debit,
        movement_credit_pkr: per.credit,
        debit_balance_pkr: Math.max(closingNet, 0),
        credit_balance_pkr: Math.max(-closingNet, 0),
      };

      let g = groupMap.get(a.accountClass);
      if (!g) {
        g = { account_class: a.accountClass, label: CLASS_LABEL[a.accountClass as AccountClassName], rows: [], subtotal: blankSub() };
        groupMap.set(a.accountClass, g);
      }
      g.rows.push(row);

      let s = sectionMap.get(section);
      if (!s) {
        s = { statement_section: section, label: TB_SECTION_LABEL[section] ?? section, rows: [], subtotal: blankSub() };
        sectionMap.set(section, s);
      }
      s.rows.push(row);

      for (const k of Object.keys(totals) as (keyof Sub)[]) {
        g.subtotal[k] = round2(g.subtotal[k] + row[k]);
        s.subtotal[k] = round2(s.subtotal[k] + row[k]);
        totals[k] = round2(totals[k] + row[k]);
      }
    }

    const groups = ACCOUNT_CLASSES.filter((c) => groupMap.has(c)).map((c) => groupMap.get(c)!);
    const section_groups = SECTION_ORDER.filter((s) => sectionMap.has(s)).map((s) => sectionMap.get(s)!);

    return {
      date_from: query.date_from ?? null,
      date_to,
      groups,
      section_groups,
      total_opening_debit_pkr: totals.opening_debit_pkr,
      total_opening_credit_pkr: totals.opening_credit_pkr,
      total_movement_debit_pkr: totals.movement_debit_pkr,
      total_movement_credit_pkr: totals.movement_credit_pkr,
      total_debit_pkr: totals.debit_balance_pkr,
      total_credit_pkr: totals.credit_balance_pkr,
      is_balanced: moneyEquals(totals.debit_balance_pkr, totals.credit_balance_pkr),
    };
  }
}

interface TrialBalanceRow {
  account_code: string;
  account_name: string;
  account_class: string;
  statement_section: string;
  normal_balance: 'DEBIT' | 'CREDIT';
  opening_debit_pkr: number;
  opening_credit_pkr: number;
  movement_debit_pkr: number;
  movement_credit_pkr: number;
  debit_balance_pkr: number;
  credit_balance_pkr: number;
}

/**
 * The statements' sections, plus the two the trial balance adds: EQUITY (equity
 * is presented by owner and role, not by header section) and UNCLASSIFIED (a
 * detail under no sectioned header — the disclosure the statements make too).
 */
const SECTION_ORDER = [
  'CURRENT_ASSET',
  'NON_CURRENT_ASSET',
  'CURRENT_LIABILITY',
  'NON_CURRENT_LIABILITY',
  'EQUITY',
  'REVENUE',
  'CONTRA_REVENUE',
  'OTHER_INCOME',
  'COST_OF_SERVICE',
  'OPERATING_EXPENSE',
  'OTHER_EXPENSE',
  'UNCLASSIFIED',
] as const;

const TB_SECTION_LABEL: Record<string, string> = {
  ...SECTION_LABEL,
  EQUITY: 'Equity',
  UNCLASSIFIED: 'Unclassified — not under a standard header',
};
