import type { JournalEntryDraft } from '../../accounting/templates/types';

type Input = {
  loanId: string;
  loanNumber: string;
  repaymentId: string;
  partyId: string;
  partyName: string;
  entryDate: Date;
  amountPkr: number;
  toAssetAccountCode: string;
  bookType: 'PACCI' | 'KATCHI';
};

/**
 * JE-19: Peshgi Recovered (Repayment).
 *
 *   DR  1010 / 1020  Cash / Bank Account             amount
 *     CR  1140       Receivable — Peshgi (Loans)     amount
 */
export function buildJE19PeshgiRecovered(input: Input): JournalEntryDraft {
  const amount = round2(input.amountPkr);
  return {
    entryType: 'PESHGI_RECOVERY',
    bookType: input.bookType,
    sourceTable: 'party_loan_repayments',
    sourceId: input.repaymentId,
    entryDate: input.entryDate,
    description: `Peshgi recovery — ${input.loanNumber} from ${input.partyName}`,
    lines: [
      {
        accountCode: input.toAssetAccountCode,
        debitAmount: amount,
        creditAmount: 0,
        partyId: input.partyId,
        description: `Repayment received — ${input.loanNumber}`,
      },
      {
        accountCode: '1140',
        debitAmount: 0,
        creditAmount: amount,
        partyId: input.partyId,
        description: `Reduce peshgi balance — ${input.loanNumber}`,
      },
    ],
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
