import type { PrismaClient } from '@coldchain/db';
import { SYSTEM_ACCOUNTS, round2, toIsoDate } from '@coldchain/shared';
import { postedEntryNumber } from '../../accounting/journal-entry.service';
import { postedLinesWhere } from '../../accounting/ledger';
import { isRemittanceEntry, outstandingByAccount } from '../../accounting/tax-remittance.service';

export interface WithholdingTaxFilters {
  date_from: string;
  date_to: string;
}

/** The sections the facility withholds under, and the account each one is owed on. */
const SECTIONS = [
  { section: 'S149', label: 'Salary (s.149)', accountCode: SYSTEM_ACCOUNTS.WHT_SALARIES },
  { section: 'S153', label: 'Goods, services & contracts (s.153)', accountCode: SYSTEM_ACCOUNTS.WHT_SUPPLIERS },
  { section: 'S155', label: 'Rent (s.155)', accountCode: SYSTEM_ACCOUNTS.WHT_RENT },
] as const;

export interface WithholdingRow {
  entry_date: string;
  entry_number: string;
  counterparty: string;
  description: string;
  /** Signed: a void's reversal shows as a negative deduction, so the rows always add up. */
  withheld_pkr: number;
  gross_pkr: number | null;
  rate_pct: number | null;
  certificate_number: string | null;
}

export interface RemittanceRow {
  remittance_date: string;
  period: string;
  challan_number: string | null;
  amount_pkr: number;
  entry_number: string | null;
}

export interface WithholdingSectionReport {
  section: string;
  label: string;
  account_code: string;
  opening_balance_pkr: number;
  withheld_pkr: number;
  remitted_pkr: number;
  /** Balance at the reporting date — what was owed then. */
  closing_balance_pkr: number;
  /**
   * What is still to pay over for the period ending on the reporting date — the figure
   * a statutory remittance clears, from the same function the remittance uses, so the
   * two can never disagree. Not the closing balance: a March remittance is dated in
   * April, so the balance at 31 March stays what was owed while this goes to zero.
   */
  unremitted_pkr: number;
  rows: WithholdingRow[];
  remittances: RemittanceRow[];
}

/**
 * Tax withheld by the facility, by section — the shape a s.165 statement wants.
 *
 * Balances come from the ledger; the deductions are named from the documents that made
 * them: a supplier payment carries its supplier, rate and certificate (docs/25 C-09), and
 * a payroll run is the staff collectively. Remittances come from the statutory remittance documents
 * with their challan numbers (C-10).
 *
 * The official book only: nothing filed with the tax authority comes from KATCHI. The
 * supplier's NTN is not on the party yet, so this gives the accountant the figures and
 * the supporting documents, not a filed return.
 */
export async function getWithholdingTax(prisma: PrismaClient, facilityId: string, filters: WithholdingTaxFilters) {
  const from = new Date(`${filters.date_from}T00:00:00.000Z`);
  const to = new Date(`${filters.date_to}T00:00:00.000Z`);
  const dayBefore = new Date(from.getTime() - 86_400_000);
  const book = 'PACCI' as const;
  const codes: string[] = SECTIONS.map((s) => s.accountCode);

  const [openingAgg, lines, unremitted, remittances] = await Promise.all([
    prisma.journalEntryLine.groupBy({
      by: ['accountCode'],
      where: { ...postedLinesWhere({ facilityId, book, to: dayBefore }), accountCode: { in: codes } },
      _sum: { debitAmount: true, creditAmount: true },
    }),
    prisma.journalEntryLine.findMany({
      where: { ...postedLinesWhere({ facilityId, book, from, to }), accountCode: { in: codes } },
      select: {
        accountCode: true,
        debitAmount: true,
        creditAmount: true,
        description: true,
        journalEntry: {
          select: { entryNumber: true, entryDate: true, entryType: true, description: true, sourceTable: true, sourceId: true },
        },
      },
      orderBy: { journalEntry: { entryDate: 'asc' } },
    }),
    outstandingByAccount(prisma, facilityId, book, to, codes),
    prisma.taxRemittance.findMany({
      where: {
        facilityId,
        bookType: book,
        voidedAt: null,
        liabilityAccountCode: { in: codes },
        remittanceDate: { gte: from, lte: to },
      },
      include: { journalEntry: { select: { entryNumber: true } } },
      orderBy: { remittanceDate: 'asc' },
    }),
  ]);

  const withholdingLines = lines.filter((l) => !isRemittanceEntry(l.journalEntry));

  const idsFrom = (table: string) => [
    ...new Set(withholdingLines.filter((l) => l.journalEntry.sourceTable === table).map((l) => l.journalEntry.sourceId)),
  ];
  const payments = await prisma.supplierPayment.findMany({
    where: { facilityId, id: { in: idsFrom('supplier_payments') } },
    select: {
      id: true,
      grossAmountPkr: true,
      withholdingRatePct: true,
      certificateNumber: true,
      supplier: { select: { name: true } },
    },
  });
  const paymentById = new Map(payments.map((p) => [p.id, p]));

  const sections: WithholdingSectionReport[] = SECTIONS.map(({ section, label, accountCode }) => {
    const opening = openingAgg.find((r) => r.accountCode === accountCode);
    const openingBalance = opening
      ? round2(Number(opening._sum.creditAmount ?? 0) - Number(opening._sum.debitAmount ?? 0))
      : 0;
    const own = lines.filter((l) => l.accountCode === accountCode);
    const net = (l: { creditAmount: unknown; debitAmount: unknown }) => Number(l.creditAmount) - Number(l.debitAmount);
    const withheld = round2(own.filter((l) => !isRemittanceEntry(l.journalEntry)).reduce((s, l) => s + net(l), 0));
    const remitted = round2(-own.filter((l) => isRemittanceEntry(l.journalEntry)).reduce((s, l) => s + net(l), 0));

    return {
      section,
      label,
      account_code: accountCode,
      opening_balance_pkr: openingBalance,
      withheld_pkr: withheld,
      remitted_pkr: remitted,
      closing_balance_pkr: round2(openingBalance + withheld - remitted),
      unremitted_pkr: unremitted.get(accountCode) ?? 0,
      rows: withholdingLines
        .filter((l) => l.accountCode === accountCode)
        .map((l) => {
          const payment = l.journalEntry.sourceTable === 'supplier_payments' ? paymentById.get(l.journalEntry.sourceId) : undefined;
          return {
            entry_date: toIsoDate(l.journalEntry.entryDate),
            entry_number: postedEntryNumber(l.journalEntry),
            counterparty:
              payment?.supplier.name ??
              (l.journalEntry.sourceTable === 'payroll_runs' ? 'Employees (payroll)' : '—'),
            description: l.description ?? l.journalEntry.description,
            withheld_pkr: round2(net(l)),
            gross_pkr: payment ? Number(payment.grossAmountPkr) : null,
            rate_pct: payment?.withholdingRatePct != null ? Number(payment.withholdingRatePct) : null,
            certificate_number: payment?.certificateNumber ?? null,
          };
        }),
      remittances: remittances
        .filter((r) => r.liabilityAccountCode === accountCode)
        .map((r) => ({
          remittance_date: toIsoDate(r.remittanceDate),
          period: `${r.periodYear}-${String(r.periodMonth).padStart(2, '0')}`,
          challan_number: r.challanNumber,
          amount_pkr: Number(r.amountPkr),
          entry_number: r.journalEntry ? postedEntryNumber(r.journalEntry) : null,
        })),
    };
  });

  const sum = (k: 'withheld_pkr' | 'remitted_pkr' | 'closing_balance_pkr' | 'unremitted_pkr') =>
    round2(sections.reduce((s, x) => s + x[k], 0));

  return {
    date_from: filters.date_from,
    date_to: filters.date_to,
    sections,
    total_withheld_pkr: sum('withheld_pkr'),
    total_remitted_pkr: sum('remitted_pkr'),
    total_outstanding_pkr: sum('unremitted_pkr'),
  };
}
