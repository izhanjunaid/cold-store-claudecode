import type { JournalEntryDraft } from './types';
import { DEFAULT_BANK_ACCOUNT_CODE } from './types';

type Input = {
  paymentId: string;
  clearedDate: Date;
  amountPkr: number;
  bookType: 'PACCI' | 'KATCHI';
  party: { id: string; partyType: string; name: string };
  referenceNumber: string | null;
};

/**
 * JE-24: Cheque Cleared.
 *
 *   DR  1020 Bank Account — Main               amount_pkr
 *     CR  1025 Cheques in Hand (Under Collection) amount_pkr
 *
 * A received cheque posts JE-02/JE-03 to 1025, not 1020 (phase/25) — it is not
 * yet bank funds and can still bounce. This entry fires when the bank actually
 * processes it, moving the amount from the clearing account into Bank.
 */
export function buildJE24ChequeCleared(input: Input): JournalEntryDraft {
  const amount = round2(input.amountPkr);
  const ref = input.referenceNumber ? ` (ref ${input.referenceNumber})` : '';

  return {
    entryType: 'CHEQUE_CLEARED',
    bookType: input.bookType,
    sourceTable: 'payments',
    sourceId: input.paymentId,
    entryDate: input.clearedDate,
    description: `Cheque cleared — ${input.party.name}${ref}`,
    lines: [
      {
        accountCode: DEFAULT_BANK_ACCOUNT_CODE,
        debitAmount: amount,
        creditAmount: 0,
        partyId: input.party.id,
        description: `Cheque cleared from ${input.party.name}`,
      },
      {
        accountCode: '1025',
        debitAmount: 0,
        creditAmount: amount,
        partyId: input.party.id,
        description: `Clear cheque-in-hand — ${input.party.name}`,
      },
    ],
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
