import { describe, it, expect } from 'vitest';
import { buildJE20PeshgiWriteOff } from '../templates/je-20-peshgi-write-off';

function totals(lines: { debitAmount: number; creditAmount: number }[]) {
  return {
    d: lines.reduce((s, l) => s + Number(l.debitAmount), 0),
    c: lines.reduce((s, l) => s + Number(l.creditAmount), 0),
  };
}

describe('JE-20 Peshgi Write-Off template', () => {
  it('balances: DR 6080 Bad Debt / CR 1140 Peshgi AR', () => {
    const draft = buildJE20PeshgiWriteOff({
      loanId: 'l1',
      loanNumber: 'L-260410-001',
      partyId: 'p1',
      partyName: 'Ghulam Hussain',
      entryDate: new Date('2026-12-31'),
      amountPkr: 75000,
      reason: 'Farmer relocated, unable to recover',
      bookType: 'PACCI',
    });
    const t = totals(draft.lines);
    expect(t.d).toBe(75000);
    expect(t.c).toBe(75000);
    expect(draft.lines.find((l) => l.accountCode === '6080')?.debitAmount).toBe(75000);
    expect(draft.lines.find((l) => l.accountCode === '1140')?.creditAmount).toBe(75000);
    expect(draft.entryType).toBe('PESHGI_WRITE_OFF');
    expect(draft.sourceTable).toBe('party_loans');
    expect(draft.lines.every((l) => l.partyId === 'p1')).toBe(true);
    expect(draft.description).toContain('L-260410-001');
    expect(draft.description).toContain('Farmer relocated');
  });

  it('handles fractional balance with rounding', () => {
    const draft = buildJE20PeshgiWriteOff({
      loanId: 'l2',
      loanNumber: 'L-260410-002',
      partyId: 'p2',
      partyName: 'Test',
      entryDate: new Date('2026-12-31'),
      amountPkr: 12345.678,
      reason: 'rounding check',
      bookType: 'PACCI',
    });
    const t = totals(draft.lines);
    expect(t.d).toBeCloseTo(t.c, 2);
    expect(t.d).toBe(12345.68);
  });
});

describe('Peshgi number format L-YYMMDD-NNN', () => {
  it('day-of-year sequence resets each day', async () => {
    const { formatPeshgiNumber, peshgiNumberPrefix } = await import('../peshgi-number');
    expect(formatPeshgiNumber(new Date('2026-04-10'), 1)).toBe('L-260410-001');
    expect(formatPeshgiNumber(new Date('2026-04-10'), 42)).toBe('L-260410-042');
    expect(formatPeshgiNumber(new Date('2026-12-31'), 999)).toBe('L-261231-999');
    expect(peshgiNumberPrefix(new Date('2026-04-10'))).toBe('L-260410-');
  });
});
