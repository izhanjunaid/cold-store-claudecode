import { describe, it, expect } from 'vitest';
import { buildJE18PeshgiIssued } from '../templates/je-18-peshgi-issued';
import { buildJE19PeshgiRecovered } from '../templates/je-19-peshgi-recovered';

function totals(lines: { debitAmount: number; creditAmount: number }[]) {
  return {
    d: lines.reduce((s, l) => s + Number(l.debitAmount), 0),
    c: lines.reduce((s, l) => s + Number(l.creditAmount), 0),
  };
}

describe('Peshgi JE templates', () => {
  it('JE-18 balances: DR 1140 / CR 1010', () => {
    const draft = buildJE18PeshgiIssued({
      loanId: 'l1',
      loanNumber: 'L-260415-001',
      partyId: 'p1',
      partyName: 'Ghulam Hussain',
      entryDate: new Date('2026-04-15'),
      amountPkr: 50000,
      fromAssetAccountCode: '1010',
      bookType: 'PACCI',
    });
    const t = totals(draft.lines);
    expect(t.d).toBe(50000);
    expect(t.c).toBe(50000);
    expect(draft.lines.find((l) => l.accountCode === '1140')?.debitAmount).toBe(50000);
    expect(draft.lines.find((l) => l.accountCode === '1010')?.creditAmount).toBe(50000);
    expect(draft.entryType).toBe('PESHGI_ISSUE');
    expect(draft.lines.every((l) => l.partyId === 'p1')).toBe(true);
  });

  it('JE-19 balances: DR cash/bank / CR 1140', () => {
    const draft = buildJE19PeshgiRecovered({
      loanId: 'l1',
      loanNumber: 'L-260415-001',
      repaymentId: 'r1',
      partyId: 'p1',
      partyName: 'Ghulam Hussain',
      entryDate: new Date('2026-06-01'),
      amountPkr: 20000,
      toAssetAccountCode: '1010',
      bookType: 'PACCI',
    });
    const t = totals(draft.lines);
    expect(t.d).toBe(20000);
    expect(t.c).toBe(20000);
    expect(draft.lines.find((l) => l.accountCode === '1010')?.debitAmount).toBe(20000);
    expect(draft.lines.find((l) => l.accountCode === '1140')?.creditAmount).toBe(20000);
    expect(draft.entryType).toBe('PESHGI_RECOVERY');
  });

  it('JE-19 partial recovery (smaller than principal) still balances', () => {
    const draft = buildJE19PeshgiRecovered({
      loanId: 'l1',
      loanNumber: 'L-260415-001',
      repaymentId: 'r2',
      partyId: 'p1',
      partyName: 'Ghulam Hussain',
      entryDate: new Date('2026-07-01'),
      amountPkr: 5000,
      toAssetAccountCode: '1020',
      bookType: 'PACCI',
    });
    const t = totals(draft.lines);
    expect(t.d).toBeCloseTo(t.c);
    expect(draft.lines.find((l) => l.accountCode === '1020')?.debitAmount).toBe(5000);
    expect(draft.lines.find((l) => l.accountCode === '1140')?.creditAmount).toBe(5000);
  });
});
