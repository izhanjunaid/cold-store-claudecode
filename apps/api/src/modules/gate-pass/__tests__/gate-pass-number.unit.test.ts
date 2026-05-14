import { describe, it, expect } from 'vitest';
import { formatGatePassNumber, gatePassNumberPrefix } from '../gate-pass-number';

describe('Gate Pass number format GP-YYMMDD-NNNN', () => {
  it('formats sequence with 4-digit pad', () => {
    expect(formatGatePassNumber(new Date('2026-05-09'), 1)).toBe('GP-260509-0001');
    expect(formatGatePassNumber(new Date('2026-05-09'), 42)).toBe('GP-260509-0042');
    expect(formatGatePassNumber(new Date('2026-12-31'), 9999)).toBe('GP-261231-9999');
  });

  it('prefix excludes sequence', () => {
    expect(gatePassNumberPrefix(new Date('2026-05-09'))).toBe('GP-260509-');
    expect(gatePassNumberPrefix(new Date('2026-01-01'))).toBe('GP-260101-');
  });

  it('prefix changes with day rollover', () => {
    expect(gatePassNumberPrefix(new Date('2026-05-09'))).not.toBe(
      gatePassNumberPrefix(new Date('2026-05-10')),
    );
  });
});
