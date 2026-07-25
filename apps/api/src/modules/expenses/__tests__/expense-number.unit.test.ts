import { describe, it, expect } from 'vitest';
import {
  formatExpenseVoucherNumber,
  expenseVoucherNumberPrefix,
} from '../expense-number';

// See invoice-number.test.ts — numbering must share the UTC clock that period
// derivation uses, or a voucher raised near a month boundary lands in a different
// month than the period it posts to.
describe('expense voucher numbering uses UTC months', () => {
  it('numbers a late-evening UTC date in the UTC month, not the local month', () => {
    const d = new Date('2026-06-30T20:00:00Z'); // already 1 July in UTC+5 local time
    expect(formatExpenseVoucherNumber(d, 1)).toBe('EXP-202606-0001');
    expect(expenseVoucherNumberPrefix(d)).toBe('EXP-202606-');
  });

  it('formats a mid-month date identically in any timezone', () => {
    const d = new Date('2026-07-15T10:00:00Z');
    expect(formatExpenseVoucherNumber(d, 42)).toBe('EXP-202607-0042');
    expect(expenseVoucherNumberPrefix(d)).toBe('EXP-202607-');
  });
});
