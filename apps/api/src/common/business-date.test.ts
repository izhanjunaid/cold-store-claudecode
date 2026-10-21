import { describe, expect, it } from 'vitest';
import {
  BUSINESS_TIME_ZONE,
  businessDate,
  businessDayStart,
  businessHour,
  normalizePlate,
  toIsoDate,
  VehicleNumber,
} from '@coldchain/shared';
import { startOfToday } from '../modules/reporting/helpers/money';
import { defaultReversalDate } from '../modules/accounting/journal-entry.service';

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

  it('a business day starts at midnight in Lahore, 19:00 UTC the evening before', () => {
    expect(businessDayStart('2026-10-12').toISOString()).toBe('2026-10-11T19:00:00.000Z');
    expect(businessDate(businessDayStart('2026-10-12'))).toBe('2026-10-12');
    expect(businessDate(new Date(businessDayStart('2026-10-12').getTime() - 1))).toBe('2026-10-11');
  });
});

describe('"now" defaults read the facility clock, not the UTC date', () => {
  it('reads the hour in Lahore: 03:00 UTC is 08:00, 19:00 UTC is midnight', () => {
    expect(businessHour(new Date('2026-10-20T03:00:00Z'))).toBe(8);
    expect(businessHour(new Date('2026-10-20T19:00:00Z'))).toBe(0);
    expect(businessHour(new Date('2026-10-20T18:59:59Z'))).toBe(23);
  });

  it('report "today" at 22:30 UTC is the next Lahore day (03:30 there)', () => {
    // A date far from the real clock, so an implementation that ignores `now` cannot pass by luck.
    expect(startOfToday(new Date('2025-01-15T22:30:00Z')).toISOString()).toBe('2025-01-16T00:00:00.000Z');
  });

  it('a reversal with no date is dated the Lahore day, so an entry posted tonight can be reversed tonight', () => {
    const original = new Date('2026-10-21T00:00:00Z'); // posted at 03:00 on the 21st in Lahore
    expect(toIsoDate(defaultReversalDate(original, new Date('2026-10-20T22:30:00Z')))).toBe('2026-10-21');
  });

  it('a reversal is never dated before its original (an accrual at a period end not yet reached)', () => {
    const accrual = new Date('2026-10-31T00:00:00Z');
    expect(toIsoDate(defaultReversalDate(accrual, new Date('2026-10-20T22:30:00Z')))).toBe('2026-10-31');
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
