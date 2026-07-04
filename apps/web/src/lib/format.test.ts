import { describe, expect, it } from 'vitest';
import { formatCount, formatDate, formatDateTime, formatMoney } from './format';

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
