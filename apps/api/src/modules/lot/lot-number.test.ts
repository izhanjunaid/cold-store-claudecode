import { describe, it, expect } from 'vitest';
import { formatLotNumber, lotNumberPrefix } from './lot-number';

describe('lot-number formatter', () => {
  it('formats LOT-YYMMDD-NNNN for 2026-04-10 next=1', () => {
    expect(formatLotNumber(new Date(2026, 3, 10), 1)).toBe('LOT-260410-0001');
  });

  it('zero-pads sequence to 4 digits', () => {
    expect(formatLotNumber(new Date(2026, 3, 10), 42)).toBe('LOT-260410-0042');
  });

  it('emits a prefix matching the formatted number', () => {
    const d = new Date(2027, 0, 3);
    expect(lotNumberPrefix(d)).toBe('LOT-270103-');
    expect(formatLotNumber(d, 7).startsWith(lotNumberPrefix(d))).toBe(true);
  });
});
