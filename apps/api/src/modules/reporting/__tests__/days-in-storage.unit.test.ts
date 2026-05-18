import { describe, it, expect } from 'vitest';
import { daysInStorage } from '../helpers/days-in-storage';

const ref = new Date(Date.UTC(2026, 4, 17));

describe('daysInStorage', () => {
  it('returns 0 for same-day inbound', () => {
    expect(daysInStorage(ref, ref)).toBe(0);
  });

  it('returns 1 for one-day-old inbound', () => {
    const yesterday = new Date(ref.getTime() - 86_400_000);
    expect(daysInStorage(yesterday, ref)).toBe(1);
  });

  it('returns 365 for one-year-old inbound', () => {
    const lastYear = new Date(ref.getTime() - 365 * 86_400_000);
    expect(daysInStorage(lastYear, ref)).toBe(365);
  });

  it('clamps future inbound dates to 0', () => {
    const tomorrow = new Date(ref.getTime() + 86_400_000);
    expect(daysInStorage(tomorrow, ref)).toBe(0);
  });
});
