import { describe, it, expect } from 'vitest';
import { derivePeriod } from '../period';

/**
 * Audit finding F-13: period_month/year were derived with server-local-time
 * getters on dates stored as @db.Date (UTC midnight). Prisma truncates the
 * stored entry_date in UTC, so the period must be derived in UTC too or the
 * stored date and its period can disagree around month boundaries.
 */
describe('derivePeriod', () => {
  it('derives the period from a date-only value (UTC midnight)', () => {
    expect(derivePeriod(new Date('2026-03-15'))).toEqual({ month: 3, year: 2026 });
    expect(derivePeriod(new Date('2026-12-01'))).toEqual({ month: 12, year: 2026 });
  });

  it('stays consistent with the stored UTC date across month boundaries', () => {
    // 22:00 UTC on 30 June = 03:00 on 1 July in Pakistan (UTC+5). @db.Date
    // stores 2026-06-30, so the period must be June — regardless of the
    // server's local timezone.
    expect(derivePeriod(new Date('2026-06-30T22:00:00Z'))).toEqual({ month: 6, year: 2026 });
    // New Year edge: 31 Dec 20:00 UTC is already 1 Jan local in UTC+5.
    expect(derivePeriod(new Date('2026-12-31T20:00:00Z'))).toEqual({ month: 12, year: 2026 });
  });
});
