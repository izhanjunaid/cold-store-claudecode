import type { JournalEntryDraft } from './types';
import { arAccountForParty, ACCOUNT_BAD_DEBT } from './types';

type Input = {
  invoiceId: string;
  invoiceNumber: string | null;
  writeOffDate: Date;
  amountPkr: number;
  reason: string;
  bookType: 'PACCI' | 'KATCHI';
  party: { id: string; partyType: string; name: string };
};

/**
 * JE-08: Bad Debt Write-Off.
 *
 *   DR  6080 Bad Debt Expense              outstanding_amount
 *     CR  1110/1120/1130 Receivable — Type  outstanding_amount
 *
 * OWNER-only. Invoice status moves to WRITTEN_OFF; AR is removed; expense recognized.
 */
export function buildJE08BadDebtWriteOff(input: Input): JournalEntryDraft {
  const arAccount = arAccountForParty(input.party.partyType);
  const amount = round2(input.amountPkr);
  const invRef = input.invoiceNumber ?? input.invoiceId.slice(0, 8);

  return {
    entryType: 'BAD_DEBT',
    bookType: input.bookType,
    sourceTable: 'invoices',
    sourceId: input.invoiceId,
    entryDate: input.writeOffDate,
    description: `Bad debt write-off invoice ${invRef} — ${input.party.name}: ${input.reason}`,
    lines: [
      {
        accountCode: ACCOUNT_BAD_DEBT,
        debitAmount: amount,
        creditAmount: 0,
        partyId: input.party.id,
        description: `Bad debt expense — ${input.party.name}`,
      },
      {
        accountCode: arAccount,
        debitAmount: 0,
        creditAmount: amount,
        partyId: input.party.id,
        description: `Write off AR — invoice ${invRef}`,
      },
    ],
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
