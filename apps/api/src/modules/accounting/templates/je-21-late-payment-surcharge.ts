import type { JournalEntryDraft } from './types';
import { arAccountForParty } from './types';

export const ACCOUNT_LATE_PAYMENT_SURCHARGE = '4210';

type Input = {
  surchargeId: string;
  invoiceNumber: string;
  surchargeDate: Date;
  amountPkr: number;
  bookType: 'PACCI' | 'KATCHI';
  billingParty: { id: string; partyType: string; name: string };
};

/**
 * JE-21: Late Payment Surcharge applied.
 *
 *   DR  AR (1110/1120/1130/1150)   amount_pkr
 *     CR  4210 Late Payment Surcharge   amount_pkr
 *
 * Erroneous surcharges are corrected with a manual REVERSAL entry —
 * posted PACCI entries are never edited.
 */
export function buildJE21LatePaymentSurcharge(input: Input): JournalEntryDraft {
  const arAccount = arAccountForParty(input.billingParty.partyType);
  const amount = Math.round(input.amountPkr * 100) / 100;

  return {
    entryType: 'SURCHARGE',
    bookType: input.bookType,
    sourceTable: 'invoice_surcharges',
    sourceId: input.surchargeId,
    entryDate: input.surchargeDate,
    description: `Late payment surcharge — invoice ${input.invoiceNumber} (${input.billingParty.name})`,
    lines: [
      {
        accountCode: arAccount,
        debitAmount: amount,
        creditAmount: 0,
        partyId: input.billingParty.id,
        description: `Surcharge on invoice ${input.invoiceNumber}`,
      },
      {
        accountCode: ACCOUNT_LATE_PAYMENT_SURCHARGE,
        debitAmount: 0,
        creditAmount: amount,
        partyId: input.billingParty.id,
        description: `Late payment surcharge — invoice ${input.invoiceNumber}`,
      },
    ],
  };
}
