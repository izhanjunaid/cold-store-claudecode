import type { JournalEntryDraft } from '../../accounting/templates/types';

type Input = {
  loanId: string;
  loanNumber: string;
  partyId: string;
  partyName: string;
  entryDate: Date;
  amountPkr: number;
  fromAssetAccountCode: string;
  bookType: 'PACCI' | 'KATCHI';
};

/**
 * JE-18: Peshgi Issued (Advance to Farmer / Arhti).
 *
 *   DR  1140  Receivable — Peshgi (Loans)    amount
 *     CR  1010 / 1020  Cash / Bank             amount
 */
export function buildJE18PeshgiIssued(input: Input): JournalEntryDraft {
  const amount = round2(input.amountPkr);
  return {
    entryType: 'PESHGI_ISSUE',
    bookType: input.bookType,
    sourceTable: 'party_loans',
    sourceId: input.loanId,
    entryDate: input.entryDate,
    description: `Peshgi ${input.loanNumber} — issued to ${input.partyName}`,
    lines: [
      {
        accountCode: '1140',
        debitAmount: amount,
        creditAmount: 0,
        partyId: input.partyId,
        description: `Loan to ${input.partyName} — ${input.loanNumber}`,
      },
      {
        accountCode: input.fromAssetAccountCode,
        debitAmount: 0,
        creditAmount: amount,
        partyId: input.partyId,
        description: `Disburse loan ${input.loanNumber}`,
      },
    ],
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
