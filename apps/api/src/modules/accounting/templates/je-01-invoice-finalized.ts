import type { ReceivableParty } from '../../party/receivable-party';
import type { JournalEntryDraft, JournalEntryLineDraft } from './types';
import { SYSTEM_ACCOUNTS, round2 } from '@coldchain/shared';

type Input = {
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: Date;
  totalPkr: number;
  gstAmountPkr: number;
  discountAmountPkr: number;
  bookType: 'PACCI' | 'KATCHI';
  billingParty: ReceivableParty;
  lot: { id: string; lotNumber: string };
  /** Every line, with the revenue account it posts to (revenueAccountForLine). All positive. */
  lines: { revenueAccountCode: string; amountPkr: number }[];
};

/**
 * JE-01: Invoice Finalized.
 *
 *   DR  party control account (AR)   total_pkr
 *   DR  4910 Discounts Allowed       discount_amount_pkr (if any) — contra-revenue, so revenue stays gross
 *     CR  revenue, per line's account  sub_total
 *     CR  2020 GST Payable             gst_amount_pkr (if any)
 *
 * Reductions go through the discount, never a negative line: a negative line
 * used to be skipped here while still lowering the AR debit, so the entry could
 * not balance (docs/25 R-07). Advances are applied by JE-04 against the invoice,
 * not netted into it (R-25).
 */
export function buildJE01InvoiceFinalized(input: Input): JournalEntryDraft {
  const party = input.billingParty.id;
  const lot = input.lot.id;
  const revenueByAccount = new Map<string, number>();
  for (const line of input.lines) {
    if (!(line.amountPkr > 0)) throw new Error('An invoice line must be positive; reductions are a discount');
    revenueByAccount.set(line.revenueAccountCode, (revenueByAccount.get(line.revenueAccountCode) ?? 0) + line.amountPkr);
  }

  const lines: JournalEntryLineDraft[] = [
    {
      accountCode: input.billingParty.controlAccountCode,
      debitAmount: round2(input.totalPkr),
      creditAmount: 0,
      partyId: party,
      lotId: lot,
      description: `Invoice ${input.invoiceNumber} — ${input.billingParty.name}`,
    },
  ];
  if (input.discountAmountPkr > 0) {
    lines.push({
      accountCode: SYSTEM_ACCOUNTS.DISCOUNTS_ALLOWED,
      debitAmount: round2(input.discountAmountPkr),
      creditAmount: 0,
      partyId: party,
      lotId: lot,
      description: `Discount allowed — invoice ${input.invoiceNumber}`,
    });
  }
  for (const [code, amount] of revenueByAccount) {
    lines.push({
      accountCode: code,
      debitAmount: 0,
      creditAmount: round2(amount),
      partyId: party,
      lotId: lot,
      description: `Revenue — invoice ${input.invoiceNumber}`,
    });
  }
  if (input.gstAmountPkr > 0) {
    lines.push({
      accountCode: SYSTEM_ACCOUNTS.GST_OUTPUT,
      debitAmount: 0,
      creditAmount: round2(input.gstAmountPkr),
      partyId: party,
      lotId: lot,
      description: `GST output tax — invoice ${input.invoiceNumber}`,
    });
  }

  return {
    entryType: 'INVOICE',
    bookType: input.bookType,
    sourceTable: 'invoices',
    sourceId: input.invoiceId,
    entryDate: input.invoiceDate,
    description: `Invoice ${input.invoiceNumber} finalized — ${input.billingParty.name} (Lot ${input.lot.lotNumber})`,
    lines,
  };
}
