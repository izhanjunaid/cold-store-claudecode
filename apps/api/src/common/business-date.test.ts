import { describe, expect, it } from 'vitest';
import { BUSINESS_TIME_ZONE, businessDate, normalizePlate, VehicleNumber } from '@coldchain/shared';

describe('businessDate — the facility clock (Asia/Karachi, UTC+5)', () => {
  it('names the zone the rules are written against', () => {
    expect(BUSINESS_TIME_ZONE).toBe('Asia/Karachi');
  });

  it('rolls to the next day at 19:00 UTC (midnight in Lahore)', () => {
    expect(businessDate(new Date('2026-10-11T19:00:00Z'))).toBe('2026-10-12');
  });

  it('is still the previous day one second earlier', () => {
    expect(businessDate(new Date('2026-10-11T18:59:59Z'))).toBe('2026-10-11');
  });

  it('is the Lahore date between midnight and 05:00, where the UTC date is a day behind', () => {
    const at = new Date('2026-10-11T21:30:00Z'); // 02:30 on the 12th in Lahore
    expect(at.toISOString().slice(0, 10)).toBe('2026-10-11');
    expect(businessDate(at)).toBe('2026-10-12');
  });

  it('crosses a year boundary', () => {
    expect(businessDate(new Date('2026-12-31T19:00:00Z'))).toBe('2027-01-01');
  });
});

describe('vehicle plates', () => {
  it('compares plates by letters and digits only', () => {
    expect(normalizePlate('lhr 5234')).toBe('LHR5234');
    expect(normalizePlate('LHR-5234')).toBe(normalizePlate('lhr 5234'));
    expect(normalizePlate(' Lhr-52 34 ')).toBe('LHR5234');
  });

  it('stores a plate trimmed and upper-cased, keeping its spacing', () => {
    expect(VehicleNumber.parse('  lhr-5234 ')).toBe('LHR-5234');
    expect(() => VehicleNumber.parse('x')).toThrow();
    expect(() => VehicleNumber.parse('A'.repeat(31))).toThrow();
  });
});
