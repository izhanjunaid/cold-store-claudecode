import type { JournalEntryDraft } from './types';
import { arAccountForParty, ACCOUNT_ADVANCE_RECEIPTS } from './types';

type Input = {
  paymentId: string;
  invoiceId: string;
  invoiceNumber: string | null;
  appliedDate: Date;
  amountPkr: number;
  bookType: 'PACCI' | 'KATCHI';
  party: { id: string; partyType: string; name: string };
};

/**
 * JE-04: Advance Applied to Invoice.
 *
 *   DR  2010 Advance Receipts from Clients   applied_amount
 *     CR  1110/1120/1130 Receivable — Type     applied_amount
 *
 * Triggers when a previously-recorded ADVANCE payment is allocated against a finalized invoice.
 */
export function buildJE04AdvanceApplied(input: Input): JournalEntryDraft {
  const arAccount = arAccountForParty(input.party.partyType);
  const amount = round2(input.amountPkr);
  const invRef = input.invoiceNumber ?? input.invoiceId.slice(0, 8);

  return {
    entryType: 'ADVANCE_APPLIED',
    bookType: input.bookType,
    sourceTable: 'payments',
    sourceId: input.paymentId,
    entryDate: input.appliedDate,
    description: `Advance applied to invoice ${invRef} — ${input.party.name}`,
    lines: [
      {
        accountCode: ACCOUNT_ADVANCE_RECEIPTS,
        debitAmount: amount,
        creditAmount: 0,
        partyId: input.party.id,
        description: `Apply advance to ${invRef}`,
      },
      {
        accountCode: arAccount,
        debitAmount: 0,
        creditAmount: amount,
        partyId: input.party.id,
        description: `Settle AR — ${input.party.name} via advance`,
      },
    ],
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
