import type { JournalEntryDraft } from '../../accounting/templates/types';
import { SYSTEM_ACCOUNTS, round2 } from '@coldchain/shared';

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
        accountCode: SYSTEM_ACCOUNTS.BAD_DEBTS,
        debitAmount: amount,
        creditAmount: 0,
        partyId: input.partyId,
        description: `Bad debt expense — peshgi ${input.loanNumber}`,
      },
      {
        accountCode: SYSTEM_ACCOUNTS.PESHGI_LOANS,
        debitAmount: 0,
        creditAmount: amount,
        partyId: input.partyId,
        description: `Write off peshgi balance — ${input.loanNumber}`,
      },
    ],
  };
}

