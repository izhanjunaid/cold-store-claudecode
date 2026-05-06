import type { JournalEntryDraft } from './types';
import { arAccountForParty, assetAccountForPaymentMethod } from './types';

type Input = {
  paymentId: string;
  dishonourDate: Date;
  amountPkr: number;
  bookType: 'PACCI' | 'KATCHI';
  party: { id: string; partyType: string; name: string };
  originalAssetAccountCode?: string | null;
};

/**
 * JE-06: Cheque Dishonoured (Bounce).
 *
 *   DR  1110/1120/1130 Receivable — Type    amount_pkr
 *     CR  1020 Bank Account — Main             amount_pkr
 *
 * Reverses the bank debit and re-opens the receivable. Posts as REVERSAL entry referencing the
 * original JE-02 (the JE service handles the reversed_by linkage).
 */
export function buildJE06ChequeDishonoured(input: Input): JournalEntryDraft {
  const arAccount = arAccountForParty(input.party.partyType);
  const bankAccount = input.originalAssetAccountCode ?? assetAccountForPaymentMethod('CHEQUE');
  const amount = round2(input.amountPkr);

  return {
    entryType: 'REVERSAL',
    bookType: input.bookType,
    sourceTable: 'payments',
    sourceId: input.paymentId,
    entryDate: input.dishonourDate,
    description: `Cheque dishonoured — ${input.party.name} (PKR ${amount})`,
    lines: [
      {
        accountCode: arAccount,
        debitAmount: amount,
        creditAmount: 0,
        partyId: input.party.id,
        description: `Re-open AR after cheque bounce — ${input.party.name}`,
      },
      {
        accountCode: bankAccount,
        debitAmount: 0,
        creditAmount: amount,
        partyId: input.party.id,
        description: `Reverse bank entry — bounced cheque`,
      },
    ],
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
