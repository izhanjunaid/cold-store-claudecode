import { describe, it, expect } from 'vitest';
import { computeSurcharge } from '../surcharge-calc';
import { buildJE21LatePaymentSurcharge } from '../../accounting/templates/je-21-late-payment-surcharge';

const rule = { enabled: true, pct_per_month: 2, grace_days: 30 };

function calc(daysOverdue: number, overrides: Record<string, unknown> = {}) {
  const invoiceDate = new Date('2026-01-01');
  const asOf = new Date(invoiceDate.getTime() + daysOverdue * 86_400_000);
  return computeSurcharge({
    rule,
    invoiceDate,
    asOf,
    totalPkr: 10000,
    amountPaidPkr: 0,
    monthsAlreadyCharged: 0,
    ...overrides,
  } as never);
}

describe('computeSurcharge', () => {
  it('no months before grace + one full 30-day block (day 59)', () => {
    expect(calc(59).chargeableMonths).toBe(0);
    expect(calc(59).suggestedPkr).toBe(0);
  });

  it('first month chargeable at grace + 30 days (day 60)', () => {
    const r = calc(60);
    expect(r.chargeableMonths).toBe(1);
    expect(r.suggestedPkr).toBe(200); // 10000 × 2%
  });

  it('still one month at day 89; two at day 90', () => {
    expect(calc(89).chargeableMonths).toBe(1);
    expect(calc(90).chargeableMonths).toBe(2);
    expect(calc(90).suggestedPkr).toBe(400);
  });

  it('subtracts months already charged (idempotency)', () => {
    const r = calc(90, { monthsAlreadyCharged: 2 });
    expect(r.chargeableMonths).toBe(0);
    expect(r.suggestedPkr).toBe(0);
  });

  it('principal excludes payments and never goes negative', () => {
    const r = calc(60, { amountPaidPkr: 4000 });
    expect(r.principalPkr).toBe(6000);
    expect(r.suggestedPkr).toBe(120);
    const paidOff = calc(60, { amountPaidPkr: 12000 });
    expect(paidOff.principalPkr).toBe(0);
    expect(paidOff.suggestedPkr).toBe(0);
  });

  it('disabled rule yields zero', () => {
    const r = calc(120, { rule: { ...rule, enabled: false } });
    expect(r.chargeableMonths).toBe(0);
    expect(r.suggestedPkr).toBe(0);
  });

  it('rounds to 2 decimal places', () => {
    const r = calc(60, { totalPkr: 3333.33, rule: { ...rule, pct_per_month: 1.5 } });
    // 3333.33 × 1.5% = 49.99995 → 50
    expect(r.suggestedPkr).toBe(50);
  });
});

describe('JE-21 late payment surcharge', () => {
  it('debits party AR, credits 4210, balanced, ACCRUAL entry type keyed to the invoice', () => {
    const draft = buildJE21LatePaymentSurcharge({
      invoiceId: 'inv1',
      invoiceNumber: 'INV-202603-0001',
      surchargeDate: new Date('2026-06-12'),
      amountPkr: 200,
      monthIndex: 1,
      bookType: 'PACCI',
      billingParty: { id: 'p1', partyType: 'TRADER', name: 'Test Trader' },
    });
    expect(draft.entryType).toBe('ACCRUAL');
    expect(draft.sourceTable).toBe('invoice_surcharge');
    expect(draft.sourceId).toBe('inv1');
    const ar = draft.lines.find((l) => l.debitAmount > 0);
    const rev = draft.lines.find((l) => l.creditAmount > 0);
    expect(ar?.accountCode).toBe('1120'); // trader AR
    expect(ar?.debitAmount).toBe(200);
    expect(rev?.accountCode).toBe('4210');
    expect(rev?.creditAmount).toBe(200);
    const totalDr = draft.lines.reduce((s, l) => s + l.debitAmount, 0);
    const totalCr = draft.lines.reduce((s, l) => s + l.creditAmount, 0);
    expect(totalDr).toBeCloseTo(totalCr);
  });
});
