import { describe, it, expect } from 'vitest';
import { presetRange, priorRange, describePeriod } from './fiscal-period';

describe('presetRange', () => {
  it('this_month spans the calendar month', () => {
    const r = presetRange('this_month', 7, new Date(2026, 2, 15)); // March 2026
    expect(r.date_from).toBe('2026-03-01');
    expect(r.date_to).toBe('2026-03-31');
    expect(r.as_of).toBe('2026-03-31');
  });

  it('this_quarter spans the calendar quarter', () => {
    const r = presetRange('this_quarter', 7, new Date(2026, 1, 10)); // Feb → Q1
    expect(r.date_from).toBe('2026-01-01');
    expect(r.date_to).toBe('2026-03-31');
  });

  it('this_fy uses prior calendar year start when before FY start month', () => {
    const r = presetRange('this_fy', 7, new Date(2026, 2, 15)); // March 2026, FY starts July
    expect(r.date_from).toBe('2025-07-01');
    expect(r.date_to).toBe('2026-06-30');
  });

  it('this_fy uses current year start when at/after FY start month', () => {
    const r = presetRange('this_fy', 7, new Date(2026, 8, 15)); // Sept 2026
    expect(r.date_from).toBe('2026-07-01');
    expect(r.date_to).toBe('2027-06-30');
  });

  it('last_fy is the FY before this_fy', () => {
    const r = presetRange('last_fy', 7, new Date(2026, 2, 15));
    expect(r.date_from).toBe('2024-07-01');
    expect(r.date_to).toBe('2025-06-30');
  });
});

describe('priorRange', () => {
  it('year mode shifts back exactly one year', () => {
    const p = priorRange({ date_from: '2026-01-01', date_to: '2026-12-31', as_of: '2026-12-31', label: 'x' }, 'year');
    expect(p.date_from).toBe('2025-01-01');
    expect(p.date_to).toBe('2025-12-31');
    expect(p.as_of).toBe('2025-12-31');
  });

  it('period mode is the contiguous preceding span', () => {
    const p = priorRange({ date_from: '2026-04-01', date_to: '2026-06-30', as_of: '2026-06-30', label: 'x' }, 'period');
    expect(p.date_to).toBe('2026-03-31'); // day before from
  });
});

describe('describePeriod', () => {
  it('formats an as-of line', () => {
    expect(describePeriod({ date_to: '2026-06-30' }, 'as_of')).toBe('As at 30 June 2026');
  });
  it('formats a period line', () => {
    expect(describePeriod({ date_from: '2026-01-01', date_to: '2026-12-31' }, 'period')).toBe('For the period 1 January 2026 to 31 December 2026');
  });
});
