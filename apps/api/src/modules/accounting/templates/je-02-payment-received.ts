import type { JournalEntryDraft } from './types';
import { arAccountForParty, assetAccountForPaymentMethod } from './types';

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
 * JE-02: Payment Received (Against Invoice).
 *
 *   DR  1010/1020/1030 Cash/Bank/Wallet     amount_pkr
 *     CR  1110/1120/1130 Receivable — Type    amount_pkr
 */
export function buildJE02PaymentReceived(input: Input): JournalEntryDraft {
  const assetAccount =
    input.assetAccountCode ?? assetAccountForPaymentMethod(input.paymentMethod);
  const arAccount = arAccountForParty(input.party.partyType);
  const amount = round2(input.amountPkr);
  const ref = input.referenceNumber ? ` (ref ${input.referenceNumber})` : '';

  return {
    entryType: 'PAYMENT',
    bookType: input.bookType,
    sourceTable: 'payments',
    sourceId: input.paymentId,
    entryDate: input.paymentDate,
    description: `Payment received from ${input.party.name} via ${input.paymentMethod}${ref}`,
    lines: [
      {
        accountCode: assetAccount,
        debitAmount: amount,
        creditAmount: 0,
        partyId: input.party.id,
        description: `${input.paymentMethod} from ${input.party.name}`,
      },
      {
        accountCode: arAccount,
        debitAmount: 0,
        creditAmount: amount,
        partyId: input.party.id,
        description: `Settle AR — ${input.party.name}`,
      },
    ],
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
