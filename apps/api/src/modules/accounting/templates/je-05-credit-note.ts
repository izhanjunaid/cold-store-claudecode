import type { JournalEntryDraft, JournalEntryLineDraft } from './types';
import { arAccountForParty } from './types';

type Input = {
  creditNoteId: string;
  creditNoteNumber: string;
  creditDate: Date;
  bookType: 'PACCI' | 'KATCHI';
  party: { id: string; partyType: string; name: string };
  invoice: { id: string; invoiceNumber: string | null };
  lineItems: { revenueAccountCode: string; amountPkr: number; description: string }[];
};

/**
 * JE-05: Credit Note Issued (Invoice Adjustment).
 *
 *   DR  4010-4150 Revenue Account (same as original)   credit_amount
 *     CR  1110/1120/1130 Receivable — Type               credit_amount
 *
 * Reverses revenue; reduces receivable. Multi-line credit notes can debit multiple revenue accounts.
 */
export function buildJE05CreditNote(input: Input): JournalEntryDraft {
  const arAccount = arAccountForParty(input.party.partyType);
  const lines: JournalEntryLineDraft[] = [];
  let total = 0;

  for (const item of input.lineItems) {
    const amt = round2(item.amountPkr);
    total += amt;
    lines.push({
      accountCode: item.revenueAccountCode,
      debitAmount: amt,
      creditAmount: 0,
      partyId: input.party.id,
      description: `Credit note ${input.creditNoteNumber}: ${item.description}`,
    });
  }

  lines.push({
    accountCode: arAccount,
    debitAmount: 0,
    creditAmount: round2(total),
    partyId: input.party.id,
    description: `Reduce AR — ${input.party.name}`,
  });

  const invRef = input.invoice.invoiceNumber ?? input.invoice.id.slice(0, 8);
  return {
    entryType: 'CREDIT_NOTE',
    bookType: input.bookType,
    sourceTable: 'credit_notes',
    sourceId: input.creditNoteId,
    entryDate: input.creditDate,
    description: `Credit note ${input.creditNoteNumber} against invoice ${invRef} — ${input.party.name}`,
    lines,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
