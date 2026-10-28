import { describe, it, expect } from 'vitest';
import { invoiceTotals } from './invoice-totals';

describe('invoiceTotals — the one arithmetic for the checkout preview and the bill it builds', () => {
  it('a bill whose stored lines sum just under a half-paisa GST totals what the checkout showed', () => {
    // 102.55 + 0.10 + 0.10 sums to 102.74999999999999 as floats; 18% of 102.75 is exactly 18.495.
    // Summed unrounded (the old bill) the GST rounded down to 18.49; the preview, on 102.75, said 18.50.
    expect(invoiceTotals({ lineAmounts: [102.55, 0.1, 0.1], gstRate: 18, bookType: 'PACCI' })).toEqual({
      subTotal: 102.75,
      discount: 0,
      gst: 18.5,
      total: 121.25,
      gstRate: 18,
    });
  });

  it('the informal book carries no GST, whatever rate is passed', () => {
    expect(invoiceTotals({ lineAmounts: [100, 20], gstRate: 18, bookType: 'KATCHI' })).toMatchObject({
      subTotal: 120,
      gst: 0,
      total: 120,
      gstRate: 0,
    });
  });

  it('GST is charged on the value after the discount', () => {
    expect(
      invoiceTotals({ lineAmounts: [100], gstRate: 18, bookType: 'PACCI', discountType: 'PERCENT', discountValue: 10 }),
    ).toMatchObject({ subTotal: 100, discount: 10, gst: 16.2, total: 106.2 });
    expect(
      invoiceTotals({ lineAmounts: [100], gstRate: 0, bookType: 'PACCI', discountType: 'FIXED', discountValue: 25 }),
    ).toMatchObject({ discount: 25, gst: 0, total: 75 });
  });

  it('a discount larger than the bill is refused, as before', () => {
    expect(() =>
      invoiceTotals({ lineAmounts: [50], gstRate: 0, bookType: 'PACCI', discountType: 'FIXED', discountValue: 60 }),
    ).toThrow();
  });
});
