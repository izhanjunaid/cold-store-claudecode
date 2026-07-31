import { afterEach, describe, expect, it } from 'vitest';
import { formatCount, formatDate, formatDateTime, formatMoney, setNumberLocale } from './format';
import { fmtAcct, fmtPlain } from './accounting-format';

// Every test below assumes the shipped default. The locale is module state, so
// any test that changes it must put it back.
afterEach(() => setNumberLocale('en-PK'));

describe('number locale (facility `number_format` setting)', () => {
  it('defaults to en-PK, which ICU groups internationally', () => {
    expect(formatMoney(1234567)).toBe('Rs 1,234,567');
    expect(formatCount(100000)).toBe('100,000');
  });

  it('groups by lakh/crore under en-IN', () => {
    setNumberLocale('en-IN');
    expect(formatMoney(1234567)).toBe('Rs 12,34,567');
    expect(formatCount(100000)).toBe('1,00,000');
  });

  // The setting is worthless if it moves operational screens but not the
  // financial statements. accounting-format must read this module's locale,
  // not keep its own copy — that duplication is exactly what P1-5 cleaned up.
  it('applies to the statement formatters too, from the same holder', () => {
    setNumberLocale('en-IN');
    expect(fmtAcct(1234567)).toBe('12,34,567');
    expect(fmtPlain(1234567)).toBe('12,34,567');
  });
});

describe('formatMoney', () => {
  it('prefixes Rs with thousands separators and no decimals by default', () => {
    expect(formatMoney(1234567)).toBe('Rs 1,234,567');
    expect(formatMoney(0)).toBe('Rs 0');
  });

  it('supports fixed decimal places', () => {
    expect(formatMoney(1500.5, { dp: 2 })).toBe('Rs 1,500.50');
  });

  it('renders missing values as an em dash', () => {
    expect(formatMoney(null)).toBe('—');
    expect(formatMoney(undefined)).toBe('—');
    expect(formatMoney(NaN)).toBe('—');
  });
});

describe('formatDate', () => {
  it('formats ISO strings as "22 Jun 2026"', () => {
    expect(formatDate('2026-06-22')).toBe('22 Jun 2026');
    expect(formatDate('2026-06-22T10:30:00Z')).toBe('22 Jun 2026');
  });

  it('accepts Date objects', () => {
    expect(formatDate(new Date(2026, 5, 22))).toBe('22 Jun 2026');
  });

  it('renders missing/invalid values as an em dash', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate(undefined)).toBe('—');
    expect(formatDate('not-a-date')).toBe('—');
    expect(formatDate('')).toBe('—');
  });
});

describe('formatDateTime', () => {
  it('formats with hour and minute, no seconds', () => {
    expect(formatDateTime(new Date(2026, 5, 22, 13, 7, 45))).toBe('22 Jun 2026, 13:07');
  });

  it('renders missing values as an em dash', () => {
    expect(formatDateTime(null)).toBe('—');
  });
});

describe('formatCount', () => {
  it('formats whole numbers with separators', () => {
    expect(formatCount(10000)).toBe('10,000');
    expect(formatCount(0)).toBe('0');
  });

  it('renders missing values as an em dash', () => {
    expect(formatCount(null)).toBe('—');
  });
});
