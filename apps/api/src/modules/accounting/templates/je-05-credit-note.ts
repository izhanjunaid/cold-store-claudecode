import type { ReceivableParty } from '../../party/receivable-party';
import type { JournalEntryDraft, JournalEntryLineDraft } from './types';
import { SYSTEM_ACCOUNTS, round2 } from '@coldchain/shared';

type Input = {
  creditNoteId: string;
  creditNoteNumber: string;
  creditDate: Date;
  bookType: 'PACCI' | 'KATCHI';
  party: ReceivableParty;
  invoiceNumber: string;
  /** Revenue credited, per invoice line, on that line's own revenue account. */
  lineItems: { revenueAccountCode: string; amountPkr: number; description: string }[];
  /** The credited revenue's share of the invoice discount. */
  discountPkr: number;
  /** The credited revenue's share of the invoice's output tax. */
  gstPkr: number;
};

/**
 * JE-05: Credit Note — the mirror of the part of JE-01 it cancels.
 *
 *   DR  revenue, per credited line's account     revenue credited
 *   DR  2020 GST Payable                         pro-rata output tax
 *     CR  4910 Discounts Allowed                 pro-rata discount
 *     CR  party control account (AR)             revenue − discount + tax
 *
 * It used to debit only revenue, so a credit note on a taxed invoice left the
 * output tax in 2020 to be remitted on a supply that never happened (docs/25 R-03).
 */
export function buildJE05CreditNote(input: Input): JournalEntryDraft {
  const party = input.party.id;
  const lines: JournalEntryLineDraft[] = input.lineItems.map((item) => ({
    accountCode: item.revenueAccountCode,
    debitAmount: round2(item.amountPkr),
    creditAmount: 0,
    partyId: party,
    description: `Credit note ${input.creditNoteNumber}: ${item.description}`,
  }));
  const revenue = round2(input.lineItems.reduce((s, i) => s + i.amountPkr, 0));
  if (input.gstPkr > 0) {
    lines.push({
      accountCode: SYSTEM_ACCOUNTS.GST_OUTPUT,
      debitAmount: round2(input.gstPkr),
      creditAmount: 0,
      partyId: party,
      description: `Output tax reversed — credit note ${input.creditNoteNumber}`,
    });
  }
  if (input.discountPkr > 0) {
    lines.push({
      accountCode: SYSTEM_ACCOUNTS.DISCOUNTS_ALLOWED,
      debitAmount: 0,
      creditAmount: round2(input.discountPkr),
      partyId: party,
      description: `Discount reversed — credit note ${input.creditNoteNumber}`,
    });
  }
  lines.push({
    accountCode: input.party.controlAccountCode,
    debitAmount: 0,
    creditAmount: round2(revenue - input.discountPkr + input.gstPkr),
    partyId: party,
    description: `Reduce AR — ${input.party.name}`,
  });

  return {
    entryType: 'CREDIT_NOTE',
    bookType: input.bookType,
    sourceTable: 'credit_notes',
    sourceId: input.creditNoteId,
    entryDate: input.creditDate,
    description: `Credit note ${input.creditNoteNumber} against invoice ${input.invoiceNumber} — ${input.party.name}`,
    lines,
  };
}
