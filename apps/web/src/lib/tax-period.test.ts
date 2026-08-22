import { describe, it, expect } from 'vitest';
import { periodToSettle } from './tax-period';

describe('periodToSettle', () => {
  it('settles the PREVIOUS month when the report ends mid-month', () => {
    // The defect: this used to return August, and the server refuses a payment
    // date before the period end, so the button was refused every time.
    expect(periodToSettle('2026-08-22')).toMatchObject({ year: 2026, month: 7, label: 'July 2026' });
  });

  it('settles that month when the report ends exactly on a month end', () => {
    expect(periodToSettle('2026-07-31')).toMatchObject({ year: 2026, month: 7, label: 'July 2026' });
    expect(periodToSettle('2026-02-28')).toMatchObject({ year: 2026, month: 2, label: 'February 2026' });
  });

  it('rolls back across a year boundary', () => {
    expect(periodToSettle('2026-01-15')).toMatchObject({ year: 2025, month: 12, label: 'December 2025' });
  });

  it('handles the first day of a month', () => {
    expect(periodToSettle('2026-03-01')).toMatchObject({ year: 2026, month: 2, label: 'February 2026' });
  });

  it('handles a leap-year February month end', () => {
    expect(periodToSettle('2028-02-29')).toMatchObject({ year: 2028, month: 2, label: 'February 2028' });
    expect(periodToSettle('2028-02-28')).toMatchObject({ year: 2028, month: 1, label: 'January 2028' });
  });

  it('falls back to today when the date input is cleared', () => {
    // <input type="date"> can be cleared to ''; without the guard the label
    // renders "undefined NaN" and the remittance posts NaN period fields.
    for (const bad of ['', 'not-a-date']) {
      const r = periodToSettle(bad);
      expect(Number.isFinite(r.year), `${bad} -> ${r.label}`).toBe(true);
      expect(r.month).toBeGreaterThanOrEqual(1);
      expect(r.month).toBeLessThanOrEqual(12);
      expect(r.label).not.toContain('undefined');
      expect(r.label).not.toContain('NaN');
    }
  });

  it('never returns a period whose end is after the report date', () => {
    for (const to of ['2026-01-01', '2026-06-14', '2026-12-31', '2027-03-09']) {
      const { year, month } = periodToSettle(to);
      const periodEnd = new Date(Date.UTC(year, month, 0));
      expect(periodEnd.getTime(), `${to} must not settle a period ending later`).toBeLessThanOrEqual(
        new Date(`${to}T00:00:00.000Z`).getTime(),
      );
    }
  });
});
