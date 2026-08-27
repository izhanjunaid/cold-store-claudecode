import type { JournalEntryDraft } from './types';

type Input = {
  facilityId: string;
  bookType: 'PACCI' | 'KATCHI';
  /** When the money actually leaves — not the tax period end. */
  paymentDate: Date;
  taxPeriodEnd: Date;
  section: string;
  sectionLabel: string;
  withholdingAccountCode: string;
  amountPkr: number;
  bankAccountCode: string;
};

/**
 * JE-29: Pay withheld tax over to the tax authority.
 *
 *   DR  2071 / 2072  Tax withheld    outstanding for the period
 *     CR  1010 / 1020   Cash / Bank     same
 *
 * Without this, 2071 and 2072 would be credited on every payment and debited
 * by nothing — the same monotonic liability that made 2020 GST Payable wrong
 * (P1-4), reproduced the moment withholding on payments out was built.
 *
 * s.149 salary withholding is NOT remitted here. 2070 already clears through
 * the payroll run's own remittance step (JE-16B), and a second path to the
 * same account would let the same liability be paid twice.
 *
 * Two dates, for the reason JE-26 has them: the tax is owed at the period end
 * and paid over weeks later, so the amount is measured at the period end while
 * the entry is dated when the money moves.
 */
export function buildJE29WithholdingRemittance(input: Input): JournalEntryDraft {
  const amount = Math.round(input.amountPkr * 100) / 100;
  return {
    entryType: 'GOVT_REMITTANCE',
    bookType: input.bookType,
    sourceTable: 'withholding_remittance',
    sourceId: input.facilityId,
    entryDate: input.paymentDate,
    description: `Withholding tax paid over — ${input.sectionLabel}, period ended ${input.taxPeriodEnd.toISOString().slice(0, 10)}`,
    lines: [
      {
        accountCode: input.withholdingAccountCode,
        debitAmount: amount,
        creditAmount: 0,
        description: `Tax withheld under ${input.section} paid over`,
      },
      {
        accountCode: input.bankAccountCode,
        debitAmount: 0,
        creditAmount: amount,
        description: `Remittance to tax authority — ${input.section}`,
      },
    ],
  };
}
