import type { JournalEntryDraft } from './types';
import { SYSTEM_ACCOUNTS, round2 } from '@coldchain/shared';

type Input = {
  paymentId: string;
  clearedDate: Date;
  amountPkr: number;
  bookType: 'PACCI' | 'KATCHI';
  party: { id: string; name: string };
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
 *
 * `amountPkr` here is the CASH leg, not the invoice amount. Where the customer
 * withheld tax at source, 1025 only ever received the net, so clearing the
 * gross would leave 1025 permanently short by the withheld amount.
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
        accountCode: SYSTEM_ACCOUNTS.BANK_MAIN,
        debitAmount: amount,
        creditAmount: 0,
        partyId: input.party.id,
        description: `Cheque cleared from ${input.party.name}`,
      },
      {
        accountCode: SYSTEM_ACCOUNTS.CHEQUES_IN_HAND,
        debitAmount: 0,
        creditAmount: amount,
        partyId: input.party.id,
        description: `Clear cheque-in-hand — ${input.party.name}`,
      },
    ],
  };
}

