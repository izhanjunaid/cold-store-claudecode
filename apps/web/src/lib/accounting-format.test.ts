import { describe, it, expect } from 'vitest';
import { fmtAcct, fmtPct, variance, fmtRatio } from './accounting-format';

describe('fmtAcct', () => {
  it('renders zero as an em dash', () => {
    expect(fmtAcct(0)).toBe('—');
    expect(fmtAcct(0.0004)).toBe('—'); // rounds to 0 at 0dp
  });
  it('renders null/undefined/NaN as em dash', () => {
    expect(fmtAcct(null)).toBe('—');
    expect(fmtAcct(undefined)).toBe('—');
    expect(fmtAcct(Number.NaN)).toBe('—');
  });
  it('groups thousands', () => {
    expect(fmtAcct(1234567)).toBe('1,234,567');
  });
  it('wraps negatives in parentheses', () => {
    expect(fmtAcct(-1234)).toBe('(1,234)');
  });
  it('honours decimal places', () => {
    expect(fmtAcct(1234.5, { dp: 2 })).toBe('1,234.50');
    expect(fmtAcct(-9.005, { dp: 2 })).toBe('(9.01)');
  });
});

describe('fmtPct', () => {
  it('formats with one decimal by default', () => {
    expect(fmtPct(12.34)).toBe('12.3%');
  });
  it('handles nullish', () => {
    expect(fmtPct(null)).toBe('—');
  });
});

describe('variance', () => {
  it('reports increase', () => {
    expect(variance(120, 100)).toEqual({ abs: 20, pct: 20, dir: 'up' });
  });
  it('reports decrease (pct of prior magnitude)', () => {
    expect(variance(80, 100)).toEqual({ abs: -20, pct: -20, dir: 'down' });
  });
  it('flat when equal', () => {
    expect(variance(100, 100)).toEqual({ abs: 0, pct: 0, dir: 'flat' });
  });
  it('null pct when prior is zero', () => {
    const v = variance(50, 0);
    expect(v.pct).toBeNull();
    expect(v.dir).toBe('up');
  });
});

describe('fmtRatio', () => {
  it('guards divide-by-zero', () => {
    expect(fmtRatio(5, 0)).toBe('—');
  });
  it('formats with x suffix', () => {
    expect(fmtRatio(3, 2)).toBe('1.50x');
  });
});
