import type { ReceivableParty } from '../../party/receivable-party';
import type { JournalEntryDraft } from './types';
import { SYSTEM_ACCOUNTS, round2 } from '@coldchain/shared';

type Input = {
  /** The surcharge invoice — a document of its own, not the invoice it charges on. */
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: Date;
  amountPkr: number;
  /** The overdue invoice being charged on, for the narration. */
  chargedOnInvoiceNumber: string;
  bookType: 'PACCI' | 'KATCHI';
  billingParty: ReceivableParty;
  lotId: string;
};

/**
 * JE-21: Late-payment surcharge invoice.
 *
 *   DR  party control account (AR)          surcharge
 *     CR  4210 Late Payment Surcharge          surcharge
 *
 * Sourced to the surcharge's own invoice, so it is allocated, credited, written
 * off and voided like any invoice (docs/25 R-08). Entries posted before this —
 * sourced `invoice_surcharge` to the overdue invoice — stay as they are: the
 * party statement and aging show them as lines of their own, cleared on account.
 */
export function buildJE21SurchargeInvoice(input: Input): JournalEntryDraft {
  const amount = round2(input.amountPkr);
  return {
    entryType: 'LATE_PAYMENT_SURCHARGE',
    bookType: input.bookType,
    sourceTable: 'invoices',
    sourceId: input.invoiceId,
    entryDate: input.invoiceDate,
    description: `Late payment surcharge ${input.invoiceNumber} on invoice ${input.chargedOnInvoiceNumber} — ${input.billingParty.name}`,
    lines: [
      {
        accountCode: input.billingParty.controlAccountCode,
        debitAmount: amount,
        creditAmount: 0,
        partyId: input.billingParty.id,
        lotId: input.lotId,
        description: `Surcharge on invoice ${input.chargedOnInvoiceNumber}`,
      },
      {
        accountCode: SYSTEM_ACCOUNTS.LATE_PAYMENT_SURCHARGE,
        debitAmount: 0,
        creditAmount: amount,
        partyId: input.billingParty.id,
        lotId: input.lotId,
        description: `Late payment surcharge — invoice ${input.chargedOnInvoiceNumber}`,
      },
    ],
  };
}
