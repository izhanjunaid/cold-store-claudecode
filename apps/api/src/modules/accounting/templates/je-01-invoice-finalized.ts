import type { JournalEntryDraft, JournalEntryLineDraft } from './types';
import {
  arAccountForParty,
  ACCOUNT_GST_PAYABLE,
  ACCOUNT_DISCOUNTS_ALLOWED,
  revenueAccountForCommodity,
} from './types';

type InvoiceLineInput = {
  lineType: string;
  description: string;
  amountPkr: number;
  serviceChargeRevenueCode?: string | null;
  ratePlanRevenueCode?: string | null;
};

type Input = {
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: Date;
  totalPkr: number;
  gstAmountPkr: number;
  discountAmountPkr?: number;
  bookType: 'PACCI' | 'KATCHI';
  billingParty: { id: string; partyType: string; name: string };
  lot: { id: string; lotNumber: string; commodityName: string };
  lines: InvoiceLineInput[];
};

/**
 * JE-01: Invoice Finalized.
 *
 *   DR  AR (1110/1120/1130/1150)        total_pkr
 *   DR  4910      Discounts Allowed      discount_amount_pkr (if any) — contra-revenue,
 *                                        revenue stays gross
 *     CR  4010-4050 Storage Revenue       storage portion (by commodity)
 *     CR  4110-4150 Service Revenue       services (by service charge revenue_account_code)
 *     CR  2020      GST Payable           gst_amount_pkr (if any)
 *     DR  2010      Advance Receipts      advance_applied (if any) — moves liability to revenue offset
 *
 * Note on ADVANCE_APPLIED line items: The line credits AR (reduces total receivable),
 * which means we need to pull DR amount out of AR. In practice, advance_applied lines
 * appear as negative-amount "ADVANCE_APPLIED" lines in invoice_line_items. We re-route
 * them to: DR 2010 Advance Receipts, CR 1110-1150 AR (reducing the AR debit).
 * For simplicity we still post one big AR debit equal to (total - advance_applied)
 * and emit a separate DR 2010 / CR (offset) line that nets to zero on AR.
 *
 * The cleanest representation is:
 *   - AR debit = total_pkr (gross)
 *   - For each ADVANCE_APPLIED line: DR 2010, CR <AR account> (reducing net AR)
 * That keeps the entry balanced and the GL transparent.
 */
export function buildJE01InvoiceFinalized(input: Input): JournalEntryDraft {
  const arAccount = arAccountForParty(input.billingParty.partyType);
  const lines: JournalEntryLineDraft[] = [];

  // Sum revenue by account
  const revenueByAccount = new Map<string, number>();
  let advanceAppliedTotal = 0;

  for (const line of input.lines) {
    if (line.lineType === 'ADVANCE_APPLIED') {
      advanceAppliedTotal += Math.abs(Number(line.amountPkr));
      continue;
    }
    let revenueCode: string;
    if (line.lineType === 'STORAGE') {
      revenueCode = line.ratePlanRevenueCode ?? revenueAccountForCommodity(input.lot.commodityName);
    } else if (line.lineType === 'SERVICE') {
      revenueCode = line.serviceChargeRevenueCode ?? '4150';
    } else {
      // ADJUSTMENT — book to misc service revenue 4150 (positive) or contra (negative)
      revenueCode = '4150';
    }
    const prev = revenueByAccount.get(revenueCode) ?? 0;
    revenueByAccount.set(revenueCode, prev + Number(line.amountPkr));
  }

  // The AR debit equals total_pkr (gross of any advance applied).
  // The advance application consumes the liability.
  // total_pkr in our schema is already net of advance_applied (subTotal - advance + GST).
  // Reconcile: net AR debit = total_pkr. Gross revenue = sum revenueByAccount + gst.
  //   net_ar = sum_rev + gst - advance_applied_total
  // ⇒ AR debit = net_ar = total_pkr
  //   advance_applied increases liability discharge (DR 2010).
  // Balance check:
  //   DR AR (total_pkr) + DR 2010 (advance) = CR revenue (sum) + CR GST (gst)
  //   total_pkr + advance = sum_rev + gst
  //   (sum_rev + gst - advance) + advance = sum_rev + gst  ✓

  lines.push({
    accountCode: arAccount,
    debitAmount: round2(input.totalPkr),
    creditAmount: 0,
    partyId: input.billingParty.id,
    lotId: input.lot.id,
    description: `Invoice ${input.invoiceNumber} — ${input.billingParty.name}`,
  });

  if (advanceAppliedTotal > 0) {
    lines.push({
      accountCode: '2010',
      debitAmount: round2(advanceAppliedTotal),
      creditAmount: 0,
      partyId: input.billingParty.id,
      lotId: input.lot.id,
      description: `Advance applied to invoice ${input.invoiceNumber}`,
    });
  }

  const discount = input.discountAmountPkr ?? 0;
  if (discount > 0) {
    lines.push({
      accountCode: ACCOUNT_DISCOUNTS_ALLOWED,
      debitAmount: round2(discount),
      creditAmount: 0,
      partyId: input.billingParty.id,
      lotId: input.lot.id,
      description: `Discount allowed — invoice ${input.invoiceNumber}`,
    });
  }

  for (const [code, amount] of revenueByAccount.entries()) {
    if (amount <= 0) continue;
    lines.push({
      accountCode: code,
      debitAmount: 0,
      creditAmount: round2(amount),
      partyId: input.billingParty.id,
      lotId: input.lot.id,
      description: `Revenue (${code}) — invoice ${input.invoiceNumber}`,
    });
  }

  if (input.gstAmountPkr > 0) {
    lines.push({
      accountCode: ACCOUNT_GST_PAYABLE,
      debitAmount: 0,
      creditAmount: round2(input.gstAmountPkr),
      partyId: input.billingParty.id,
      lotId: input.lot.id,
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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
