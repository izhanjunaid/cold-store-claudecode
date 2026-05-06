import type { JournalEntryDraft } from './types';
import { assetAccountForPaymentMethod, ACCOUNT_ADVANCE_RECEIPTS } from './types';

type Input = {
  paymentId: string;
  paymentDate: Date;
  amountPkr: number;
  paymentMethod: string;
  referenceNumber: string | null;
  bookType: 'PACCI' | 'KATCHI';
  party: { id: string; partyType: string; name: string };
  assetAccountCode?: string | null;
};

/**
 * JE-03: Advance Payment Received (Before Invoice).
 *
 *   DR  1010/1020/1030 Cash/Bank/Wallet      amount_pkr
 *     CR  2010 Advance Receipts from Clients   amount_pkr (LIABILITY)
 */
export function buildJE03AdvanceReceived(input: Input): JournalEntryDraft {
  const assetAccount =
    input.assetAccountCode ?? assetAccountForPaymentMethod(input.paymentMethod);
  const amount = round2(input.amountPkr);
  const ref = input.referenceNumber ? ` (ref ${input.referenceNumber})` : '';

  return {
    entryType: 'ADVANCE',
    bookType: input.bookType,
    sourceTable: 'payments',
    sourceId: input.paymentId,
    entryDate: input.paymentDate,
    description: `Advance received from ${input.party.name} via ${input.paymentMethod}${ref}`,
    lines: [
      {
        accountCode: assetAccount,
        debitAmount: amount,
        creditAmount: 0,
        partyId: input.party.id,
        description: `${input.paymentMethod} advance from ${input.party.name}`,
      },
      {
        accountCode: ACCOUNT_ADVANCE_RECEIPTS,
        debitAmount: 0,
        creditAmount: amount,
        partyId: input.party.id,
        description: `Advance liability — ${input.party.name}`,
      },
    ],
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
