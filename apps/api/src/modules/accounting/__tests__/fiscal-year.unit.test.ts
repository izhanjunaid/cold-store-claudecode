import { describe, it, expect } from 'vitest';
import { fiscalYearStart } from '../fiscal-year';

describe('fiscalYearStart (UTC)', () => {
  it('July fiscal-year: a December date maps to that July 1', () => {
    expect(fiscalYearStart(new Date('2026-12-31T00:00:00Z'), 7).toISOString().slice(0, 10)).toBe('2026-07-01');
  });

  it('July fiscal-year: a June date maps to the PREVIOUS July 1', () => {
    expect(fiscalYearStart(new Date('2026-06-30T00:00:00Z'), 7).toISOString().slice(0, 10)).toBe('2025-07-01');
  });

  it('July fiscal-year: July 1 itself is the start of its own year', () => {
    expect(fiscalYearStart(new Date('2026-07-01T00:00:00Z'), 7).toISOString().slice(0, 10)).toBe('2026-07-01');
  });

  it('January fiscal-year: calendar-year passthrough', () => {
    expect(fiscalYearStart(new Date('2026-03-15T00:00:00Z'), 1).toISOString().slice(0, 10)).toBe('2026-01-01');
    expect(fiscalYearStart(new Date('2026-12-31T00:00:00Z'), 1).toISOString().slice(0, 10)).toBe('2026-01-01');
  });

  it('uses UTC, not local time, at a month boundary', () => {
    // 2026-06-30T20:00Z is already 1 July in UTC+5 local, but UTC keeps it in June →
    // still the prior (2025-07) fiscal year.
    expect(fiscalYearStart(new Date('2026-06-30T20:00:00Z'), 7).toISOString().slice(0, 10)).toBe('2025-07-01');
  });
});
