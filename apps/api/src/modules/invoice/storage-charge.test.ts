import { describe, it, expect } from 'vitest';
import { computeStorageCharge } from './storage-charge';

const base = {
  rateAmountPkr: 10,
  quantityBags: 100,
  minBillingDays: 1,
};

function days(n: number): { periodStart: Date; periodEnd: Date } {
  const start = new Date('2026-01-01');
  const end = new Date(start);
  end.setDate(start.getDate() + n);
  return { periodStart: start, periodEnd: end };
}

describe('computeStorageCharge', () => {
  it('SEASONAL: amount = qty × rate regardless of period length', () => {
    const r = computeStorageCharge({ ...base, rateType: 'SEASONAL_PER_BAG', ...days(60) });
    expect(r.amountPkr).toBe(1000); // 100 × 10
    expect(r.description).toContain('Seasonal');
  });

  it('SEASONAL: same amount for 30-day and 90-day period', () => {
    const r30 = computeStorageCharge({ ...base, rateType: 'SEASONAL_PER_BAG', ...days(30) });
    const r90 = computeStorageCharge({ ...base, rateType: 'SEASONAL_PER_BAG', ...days(90) });
    expect(r30.amountPkr).toBe(r90.amountPkr);
  });

  it('MONTHLY: 29 days → 1 month; 31 days → 2 months', () => {
    const r29 = computeStorageCharge({ ...base, rateType: 'MONTHLY_PER_BAG', ...days(29) });
    const r31 = computeStorageCharge({ ...base, rateType: 'MONTHLY_PER_BAG', ...days(31) });
    expect(r29.amountPkr).toBe(1000); // 100 × 10 × 1
    expect(r31.amountPkr).toBe(2000); // 100 × 10 × 2
  });

  it('MONTHLY: 60 days → 2 months; 61 days → 3 months', () => {
    const r60 = computeStorageCharge({ ...base, rateType: 'MONTHLY_PER_BAG', ...days(60) });
    const r61 = computeStorageCharge({ ...base, rateType: 'MONTHLY_PER_BAG', ...days(61) });
    expect(r60.amountPkr).toBe(2000);
    expect(r61.amountPkr).toBe(3000);
  });

  it('DAILY: amount = qty × rate × days', () => {
    const r = computeStorageCharge({ ...base, rateType: 'DAILY_PER_BAG', ...days(15) });
    expect(r.amountPkr).toBe(15000); // 100 × 10 × 15
    expect(r.days).toBe(15);
  });

  it('min_billing_days floor: same-day (0 days) uses minBillingDays', () => {
    const sameDay = { periodStart: new Date('2026-01-01'), periodEnd: new Date('2026-01-01') };
    const r = computeStorageCharge({ ...base, rateType: 'DAILY_PER_BAG', minBillingDays: 3, ...sameDay });
    expect(r.days).toBe(3);
    expect(r.amountPkr).toBe(3000); // 100 × 10 × 3
  });

  it('rounding: result is rounded to 2 decimals', () => {
    const r = computeStorageCharge({
      rateType: 'DAILY_PER_BAG',
      rateAmountPkr: 3.33,
      quantityBags: 7,
      minBillingDays: 1,
      ...days(3),
    });
    expect(r.amountPkr).toBe(Math.round(7 * 3.33 * 3 * 100) / 100);
    expect(Number.isFinite(r.amountPkr)).toBe(true);
  });

  it('zero bags throws an error', () => {
    expect(() =>
      computeStorageCharge({ ...base, rateType: 'SEASONAL_PER_BAG', quantityBags: 0, ...days(10) }),
    ).toThrow('quantityBags must be positive');
  });
});
