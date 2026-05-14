import type { JournalEntryDraft } from '../../accounting/templates/types';
import { ACCOUNT_BAD_DEBT } from '../../accounting/templates/types';

const ACCOUNT_PESHGI_AR = '1140';

type Input = {
  loanId: string;
  loanNumber: string;
  partyId: string;
  partyName: string;
  entryDate: Date;
  amountPkr: number;
  reason: string;
  bookType: 'PACCI' | 'KATCHI';
};

/**
 * JE-20: Peshgi Write-Off (bad debt).
 *
 *   DR  6080  Bad Debt Expense                 outstanding_balance
 *     CR  1140  Receivable — Peshgi (Loans)     outstanding_balance
 *
 * OWNER-only. Loan transitions to WRITTEN_OFF; balance cleared.
 */
export function buildJE20PeshgiWriteOff(input: Input): JournalEntryDraft {
  const amount = round2(input.amountPkr);
  return {
    entryType: 'PESHGI_WRITE_OFF',
    bookType: input.bookType,
    sourceTable: 'party_loans',
    sourceId: input.loanId,
    entryDate: input.entryDate,
    description: `Peshgi write-off — ${input.loanNumber} (${input.partyName}): ${input.reason}`,
    lines: [
      {
        accountCode: ACCOUNT_BAD_DEBT,
        debitAmount: amount,
        creditAmount: 0,
        partyId: input.partyId,
        description: `Bad debt expense — peshgi ${input.loanNumber}`,
      },
      {
        accountCode: ACCOUNT_PESHGI_AR,
        debitAmount: 0,
        creditAmount: amount,
        partyId: input.partyId,
        description: `Write off peshgi balance — ${input.loanNumber}`,
      },
    ],
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
