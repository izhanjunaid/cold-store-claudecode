import { describe, expect, it } from 'vitest';
import { parseAmount } from './page';

describe('parseAmount (P3-1 — grouped amount must not become a silent zero)', () => {
  it('accepts a grouped amount, in either grouping convention', () => {
    // The whole point: a lakh/crore reader types what they read.
    expect(parseAmount('40,00,000')).toBe(4000000);
    expect(parseAmount('4,000,000')).toBe(4000000);
  });

  // parseFloat('40,00,000') === 40 — a plausible-looking wrong number, which is
  // worse than a zero because nothing about it says "I dropped your input".
  it('does not truncate at the first separator the way parseFloat does', () => {
    expect(parseAmount('40,00,000')).not.toBe(40);
  });

  it('treats an empty cell as zero — a blank debit or credit is legitimate', () => {
    expect(parseAmount('')).toBe(0);
    expect(parseAmount('   ')).toBe(0);
  });

  it('returns null for anything unparseable, so the caller can refuse', () => {
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('1.2.3')).toBeNull();
    expect(parseAmount('12a')).toBeNull();
  });

  it('rejects negatives — a journal line carries its side, not a sign', () => {
    expect(parseAmount('-500')).toBeNull();
  });

  it('keeps decimals', () => {
    expect(parseAmount('1,234.56')).toBe(1234.56);
  });
});
