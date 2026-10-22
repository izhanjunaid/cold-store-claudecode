import { round2, sumMoney } from '@coldchain/shared';
import { Errors } from '../../common/errors';

export function computeDiscountAmount(
  subTotal: number,
  discountType: 'PERCENT' | 'FIXED' | null,
  discountValue: number | null,
): number {
  if (!discountType || discountValue == null) return 0;
  const amount =
    discountType === 'PERCENT'
      ? round2(subTotal * (discountValue / 100))
      : discountValue;
  if (amount > subTotal) throw Errors.INVOICE_DISCOUNT_EXCEEDS_SUBTOTAL();
  return amount;
}

export interface InvoiceTotalsInput {
  /** Each line's amount, already to the paisa. */
  lineAmounts: number[];
  gstRate: number;
  bookType: string;
  discountType?: 'PERCENT' | 'FIXED' | null;
  discountValue?: number | null;
}

export interface InvoiceTotals {
  subTotal: number;
  discount: number;
  gst: number;
  total: number;
  /** The rate actually applied: 0 on the informal book. */
  gstRate: number;
}

/**
 * An invoice's totals from its lines: the one arithmetic behind the bill that is stored
 * (InvoiceRepository.recomputeTotals, the storage draft) and the bill the dispatch checkout
 * shows before it posts, so the two cannot disagree. The subtotal is rounded once before GST:
 * summed unrounded, 102.55 + 0.10 + 0.10 falls just under 102.75 and an exact half-paisa
 * GST rounded the other way, which refused the reviewed total forever.
 */
export function invoiceTotals(input: InvoiceTotalsInput): InvoiceTotals {
  const subTotal = sumMoney(input.lineAmounts);
  // KATCHI never carries sales tax (docs/25 R-06), whatever rate an older row holds.
  const gstRate = input.bookType === 'KATCHI' ? 0 : input.gstRate;
  const discount = computeDiscountAmount(subTotal, input.discountType ?? null, input.discountValue ?? null);
  // GST applies to the post-discount taxable value.
  const gst = round2((subTotal - discount) * (gstRate / 100));
  const total = round2(subTotal - discount + gst);
  return { subTotal, discount, gst, total, gstRate };
}
