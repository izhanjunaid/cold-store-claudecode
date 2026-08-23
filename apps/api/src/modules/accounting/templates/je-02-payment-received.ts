import type { JournalEntryDraft } from './types';
import { arAccountForParty, assetAccountForPaymentMethod, ACCOUNT_TAX_WITHHELD_RECEIVABLE } from './types';

type Input = {
  paymentId: string;
  paymentDate: Date;
  amountPkr: number;
  paymentMethod: string;
  referenceNumber: string | null;
  bookType: 'PACCI' | 'KATCHI';
  party: { id: string; partyType: string; name: string };
  assetAccountCode?: string | null;
  /**
   * Tax the customer deducted at source (s.153). Zero for almost every
   * receipt. `amountPkr` stays gross — it is what settles the invoice.
   */
  taxWithheldPkr?: number;
};

/**
 * JE-02: Payment Received (Against Invoice).
 *
 *   DR  1010/1020/1030 Cash/Bank/Wallet     amount_pkr − withheld
 *   DR  1240 Tax Withheld at Source          withheld (if any)
 *     CR  1110/1120/1130 Receivable — Type    amount_pkr
 *
 * The invoice settles in FULL. Tax the customer deducts at source is not a
 * discount and not a shortfall — it is an advance of the facility's own income
 * tax, paid to the authority on its behalf, so it belongs in 1240 as a
 * receivable. Before this it simply vanished, leaving the invoice looking
 * part-unpaid forever.
 */
export function buildJE02PaymentReceived(input: Input): JournalEntryDraft {
  const assetAccount =
    input.assetAccountCode ?? assetAccountForPaymentMethod(input.paymentMethod);
  const arAccount = arAccountForParty(input.party.partyType);
  const amount = round2(input.amountPkr);
  const withheld = round2(input.taxWithheldPkr ?? 0);
  const cash = round2(amount - withheld);
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
        debitAmount: cash,
        creditAmount: 0,
        partyId: input.party.id,
        description: `${input.paymentMethod} from ${input.party.name}`,
      },
      ...(withheld > 0
        ? [
            {
              accountCode: ACCOUNT_TAX_WITHHELD_RECEIVABLE,
              debitAmount: withheld,
              creditAmount: 0,
              partyId: input.party.id,
              description: `Tax withheld at source by ${input.party.name}`,
            },
          ]
        : []),
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
