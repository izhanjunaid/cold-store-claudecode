import type { PrismaClient } from '@coldchain/db';
import { round2 } from '../helpers/money';
import {
  WITHHOLDING_ACCOUNT_BY_SECTION,
  WITHHOLDING_LABELS,
} from '../../expenses/templates/withholding';

export interface WithholdingTaxFilters {
  date_from: string;
  date_to: string;
}

export interface WithholdingRow {
  entry_date: string;
  entry_number: string;
  counterparty: string;
  description: string;
  withheld_pkr: number;
}

export interface WithholdingSectionReport {
  section: string;
  label: string;
  account_code: string;
  opening_balance_pkr: number;
  withheld_pkr: number;
  remitted_pkr: number;
  closing_balance_pkr: number;
  rows: WithholdingRow[];
}

/**
 * Tax withheld by the facility, by section — the shape a s.165 statement wants.
 *
 * Read-only over journal_entry_lines. There is no withholding table and there
 * should not be one: the GL already records every deduction, and a second
 * store would be one more thing to keep in step.
 *
 * The official book only. KATCHI is the informal ledger and nothing filed with
 * the tax authority can come from it.
 *
 * Counterparty is the honest weak point. Expense vouchers carry a free-text
 * vendor_name rather than a party, so that is what is reported; payroll
 * withholding is against staff collectively, not one payee. Neither is a
 * substitute for the CNIC/NTN a real s.165 filing needs — this gives the
 * accountant the figures and the supporting entries, not a filed return.
 */
export async function getWithholdingTax(
  prisma: PrismaClient,
  facilityId: string,
  filters: WithholdingTaxFilters,
) {
  const from = new Date(`${filters.date_from}T00:00:00.000Z`);
  const to = new Date(`${filters.date_to}T00:00:00.000Z`);
  const dayBefore = new Date(from.getTime() - 24 * 60 * 60 * 1000);
  const codes = Object.values(WITHHOLDING_ACCOUNT_BY_SECTION);

  const [openingAgg, lines] = await Promise.all([
    prisma.journalEntryLine.groupBy({
      by: ['accountCode'],
      where: {
        facilityId,
        accountCode: { in: codes },
        journalEntry: { postingStatus: 'POSTED', bookType: 'PACCI', entryDate: { lte: dayBefore } },
      },
      _sum: { debitAmount: true, creditAmount: true },
    }),
    prisma.journalEntryLine.findMany({
      where: {
        facilityId,
        accountCode: { in: codes },
        journalEntry: {
          postingStatus: 'POSTED',
          bookType: 'PACCI',
          entryDate: { gte: from, lte: to },
        },
      },
      select: {
        accountCode: true,
        debitAmount: true,
        creditAmount: true,
        description: true,
        journalEntry: {
          select: { entryNumber: true, entryDate: true, description: true, sourceTable: true, sourceId: true },
        },
      },
      orderBy: { journalEntry: { entryDate: 'asc' } },
    }),
  ]);

  // Expense vouchers carry the payee as free text, so resolve it rather than
  // showing the accountant a voucher number and nothing else.
  const voucherIds = [
    ...new Set(
      lines
        .filter((l) => l.journalEntry.sourceTable === 'expense_vouchers')
        .map((l) => l.journalEntry.sourceId),
    ),
  ];
  const vouchers = voucherIds.length
    ? await prisma.expenseVoucher.findMany({
        where: { facilityId, id: { in: voucherIds } },
        select: { id: true, vendorName: true, voucherNumber: true },
      })
    : [];
  const vendorById = new Map(vouchers.map((v) => [v.id, v.vendorName ?? v.voucherNumber]));

  const openingByCode = new Map(
    openingAgg.map((r) => [
      r.accountCode,
      round2(Number(r._sum.creditAmount ?? 0) - Number(r._sum.debitAmount ?? 0)),
    ]),
  );

  const sections: WithholdingSectionReport[] = Object.entries(WITHHOLDING_ACCOUNT_BY_SECTION).map(
    ([section, accountCode]) => {
      const sectionLines = lines.filter((l) => l.accountCode === accountCode);
      const withheld = round2(sectionLines.reduce((s, l) => s + Number(l.creditAmount), 0));
      const remitted = round2(sectionLines.reduce((s, l) => s + Number(l.debitAmount), 0));
      const opening = openingByCode.get(accountCode) ?? 0;

      return {
        section,
        label: WITHHOLDING_LABELS[section] ?? section,
        account_code: accountCode,
        opening_balance_pkr: opening,
        withheld_pkr: withheld,
        remitted_pkr: remitted,
        closing_balance_pkr: round2(opening + withheld - remitted),
        rows: sectionLines
          .filter((l) => Number(l.creditAmount) > 0)
          .map((l) => ({
            entry_date: l.journalEntry.entryDate.toISOString().slice(0, 10),
            entry_number: l.journalEntry.entryNumber,
            counterparty:
              vendorById.get(l.journalEntry.sourceId) ??
              (l.journalEntry.sourceTable === 'payroll_runs' ? 'Employees (payroll)' : '—'),
            description: l.description ?? l.journalEntry.description,
            withheld_pkr: round2(Number(l.creditAmount)),
          })),
      };
    },
  );

  const sum = (k: 'withheld_pkr' | 'remitted_pkr' | 'closing_balance_pkr') =>
    round2(sections.reduce((s, x) => s + x[k], 0));

  return {
    date_from: filters.date_from,
    date_to: filters.date_to,
    sections,
    total_withheld_pkr: sum('withheld_pkr'),
    total_remitted_pkr: sum('remitted_pkr'),
    total_outstanding_pkr: sum('closing_balance_pkr'),
  };
}
