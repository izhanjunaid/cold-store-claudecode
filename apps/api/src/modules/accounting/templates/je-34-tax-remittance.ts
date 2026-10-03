import type { JournalEntryDraft } from './types';

type Input = {
  remittanceId: string;
  remittanceDate: Date;
  periodEnd: string;
  liability: { code: string; name: string };
  paidFromAccountCode: string;
  amountPkr: number;
  challanNumber: string | null;
  bookType: 'PACCI' | 'KATCHI';
};

/**
 * JE-34: A statutory liability paid over to the state (docs/25 C-10).
 *
 *   DR  2060 / 2061 / 2070 / 2071 / 2072   outstanding at the period end
 *     CR  a cash equivalent                  same
 *
 * Two dates, for the reason JE-26 has them: the amount is measured at the period end,
 * the entry is dated when the money moves. Replaces JE-29 (withholding only, no
 * document) and JE-16B (one payroll run at a time, amounts from the browser).
 */
export function buildJE34TaxRemittance(input: Input): JournalEntryDraft {
  const challan = input.challanNumber ? ` — challan ${input.challanNumber}` : '';
  return {
    entryType: 'TAX_REMITTANCE',
    bookType: input.bookType,
    sourceTable: 'tax_remittances',
    sourceId: input.remittanceId,
    entryDate: input.remittanceDate,
    description: `${input.liability.name} paid over, period ended ${input.periodEnd}${challan}`,
    lines: [
      {
        accountCode: input.liability.code,
        debitAmount: input.amountPkr,
        creditAmount: 0,
        description: `Paid over${challan}`,
      },
      {
        accountCode: input.paidFromAccountCode,
        debitAmount: 0,
        creditAmount: input.amountPkr,
        description: `${input.liability.name} paid over`,
      },
    ],
  };
}
