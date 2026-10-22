import { describe, it, expect, vi } from 'vitest';
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

  it('counts to the facility day: at 03:30 in Lahore (22:30 UTC) a lot in since 1 Oct is 20 days in, as the dashboard says', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-20T22:30:00Z'));
    try {
      expect(daysInStorage(new Date('2026-10-01T00:00:00Z'))).toBe(20);
    } finally {
      vi.useRealTimers();
    }
  });
});
