import type { JournalEntryDraft } from './types';
import { arAccountForParty } from './types';

export const ACCOUNT_LATE_PAYMENT_SURCHARGE = '4210';

type Input = {
  invoiceId: string;
  invoiceNumber: string;
  surchargeDate: Date;
  amountPkr: number;
  monthIndex: number;
  bookType: 'PACCI' | 'KATCHI';
  billingParty: { id: string; partyType: string; name: string };
};

/**
 * JE-21: Late Payment Surcharge applied (one entry per chargeable month).
 *
 *   DR  AR (1110/1120/1130/1150)   amount_pkr
 *     CR  4210 Late Payment Surcharge   amount_pkr
 *
 * Migration-free (phase/19): the GL is the system of record — no surcharge
 * table. sourceTable/sourceId key the entries to the invoice so they can be
 * counted (idempotency) and listed. Erroneous surcharges are corrected with a
 * manual REVERSAL — posted entries are never edited.
 */
export function buildJE21LatePaymentSurcharge(input: Input): JournalEntryDraft {
  const arAccount = arAccountForParty(input.billingParty.partyType);
  const amount = Math.round(input.amountPkr * 100) / 100;

  return {
    entryType: 'ACCRUAL',
    bookType: input.bookType,
    sourceTable: 'invoice_surcharge',
    sourceId: input.invoiceId,
    entryDate: input.surchargeDate,
    description: `Late payment surcharge (month ${input.monthIndex}) — invoice ${input.invoiceNumber} (${input.billingParty.name})`,
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
