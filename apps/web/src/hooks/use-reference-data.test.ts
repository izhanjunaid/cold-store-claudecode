import { describe, it, expect } from 'vitest';
import { isCashOrBank, isExpenseAccount, type AccountRef } from './use-reference-data';

/**
 * The pickers read the chart's flags (docs/25 C-05, C-07), never a list of codes: an
 * owner's second bank is cash, cheques in hand are not; payroll and depreciation
 * accounts are moved by their own flows, spoilage is a bookable cost.
 */
const account = (code: string, cls: string, flags: Partial<AccountRef> = {}): AccountRef => ({
  account_code: code,
  account_name: code,
  account_class: cls,
  account_type: 'DETAIL',
  parent_account_code: null,
  normal_balance: 'DEBIT',
  is_active: true,
  is_cash_equivalent: false,
  allow_manual_posting: true,
  requires_party: false,
  ...flags,
});

describe('account pickers read the chart flags', () => {
  it('cash: an owner-added bank is in, cheques in hand are out', () => {
    expect(isCashOrBank(account('1047', 'ASSET', { is_cash_equivalent: true }))).toBe(true);
    expect(isCashOrBank(account('1025', 'ASSET', { allow_manual_posting: false }))).toBe(false);
  });

  it('costs: payroll and depreciation are out, spoilage is in, a non-cost class is out', () => {
    expect(isExpenseAccount(account('6010', 'EXPENSE', { allow_manual_posting: false }))).toBe(false);
    expect(isExpenseAccount(account('6120', 'EXPENSE', { allow_manual_posting: false }))).toBe(false);
    expect(isExpenseAccount(account('6150', 'EXPENSE'))).toBe(true);
    expect(isExpenseAccount(account('5010', 'COST_OF_SERVICE'))).toBe(true);
    expect(isExpenseAccount(account('1020', 'ASSET', { is_cash_equivalent: true }))).toBe(false);
  });
});
