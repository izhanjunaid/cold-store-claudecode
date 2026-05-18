import { describe, it, expect } from 'vitest';
import { ageInDays, bucketFor, emptyBuckets } from '../helpers/aging-buckets';

const asOf = new Date(Date.UTC(2026, 4, 17)); // 2026-05-17

function daysAgo(n: number): Date {
  return new Date(asOf.getTime() - n * 86_400_000);
}

describe('aging-buckets', () => {
  it('classifies same-day invoice as b_0_30', () => {
    expect(bucketFor(asOf, asOf)).toBe('b_0_30');
  });

  it('boundary 30 days falls in b_0_30, 31 days in b_31_60', () => {
    expect(bucketFor(asOf, daysAgo(30))).toBe('b_0_30');
    expect(bucketFor(asOf, daysAgo(31))).toBe('b_31_60');
  });

  it('boundary 60 days falls in b_31_60, 61 days in b_61_90', () => {
    expect(bucketFor(asOf, daysAgo(60))).toBe('b_31_60');
    expect(bucketFor(asOf, daysAgo(61))).toBe('b_61_90');
  });

  it('boundary 90 days falls in b_61_90, 91+ days in b_90_plus', () => {
    expect(bucketFor(asOf, daysAgo(90))).toBe('b_61_90');
    expect(bucketFor(asOf, daysAgo(91))).toBe('b_90_plus');
    expect(bucketFor(asOf, daysAgo(365))).toBe('b_90_plus');
  });

  it('future invoice date treated as 0 days old (b_0_30)', () => {
    const futureDate = new Date(asOf.getTime() + 5 * 86_400_000);
    expect(ageInDays(asOf, futureDate)).toBe(0);
    expect(bucketFor(asOf, futureDate)).toBe('b_0_30');
  });

  it('emptyBuckets returns zeroed structure', () => {
    expect(emptyBuckets()).toEqual({
      b_0_30: 0,
      b_31_60: 0,
      b_61_90: 0,
      b_90_plus: 0,
      total_pkr: 0,
    });
  });
});
