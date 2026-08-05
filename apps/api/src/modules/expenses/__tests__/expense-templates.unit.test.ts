import { describe, it, expect } from 'vitest';
import { buildJE17AExpensePaid } from '../templates/je-17a-expense-paid';
import { buildJE17BExpenseAccrued } from '../templates/je-17b-expense-accrued';
import { buildJE17BPayAccruedExpense } from '../templates/je-17b-pay-accrued-payment';
import { buildJE17CPettyCashReplenish } from '../templates/je-17c-petty-cash-replenish';

function totals(lines: { debitAmount: number; creditAmount: number }[]) {
  return {
    d: lines.reduce((s, l) => s + Number(l.debitAmount), 0),
    c: lines.reduce((s, l) => s + Number(l.creditAmount), 0),
  };
}

describe('Expense JE templates', () => {
  it('JE-17A balances: DR expense / CR cash or bank', () => {
    const draft = buildJE17AExpensePaid({
      voucherId: 'v1',
      voucherNumber: 'EXP-202604-0001',
      entryDate: new Date('2026-04-15'),
      expenseAccountCode: '5010',
      assetAccountCode: '1020',
      amountPkr: 185000,
      bookType: 'PACCI',
    });
    const t = totals(draft.lines);
    expect(t.d).toBe(185000);
    expect(t.c).toBe(185000);
    expect(draft.lines.find((l) => l.accountCode === '5010')?.debitAmount).toBe(185000);
    expect(draft.lines.find((l) => l.accountCode === '1020')?.creditAmount).toBe(185000);
    expect(draft.entryType).toBe('EXPENSE');
  });

  it('JE-17B balances: DR expense / CR 2040 utilities payable', () => {
    const draft = buildJE17BExpenseAccrued({
      voucherId: 'v2',
      voucherNumber: 'EXP-202604-0002',
      entryDate: new Date('2026-04-28'),
      expenseAccountCode: '5010',
      amountPkr: 185000,
      bookType: 'PACCI',
    });
    const t = totals(draft.lines);
    expect(t.d).toBe(185000);
    expect(t.c).toBe(185000);
    expect(draft.lines.find((l) => l.accountCode === '5010')?.debitAmount).toBe(185000);
    expect(draft.lines.find((l) => l.accountCode === '2040')?.creditAmount).toBe(185000);
  });

  it('JE-17B-PAY balances: DR 2040 / CR cash or bank (no expense recognised)', () => {
    const draft = buildJE17BPayAccruedExpense({
      voucherId: 'v3',
      voucherNumber: 'EXP-202604-0002',
      entryDate: new Date('2026-05-05'),
      assetAccountCode: '1020',
      amountPkr: 185000,
      bookType: 'PACCI',
    });
    const t = totals(draft.lines);
    expect(t.d).toBe(185000);
    expect(t.c).toBe(185000);
    expect(draft.lines.find((l) => l.accountCode === '2040')?.debitAmount).toBe(185000);
    expect(draft.lines.find((l) => l.accountCode === '1020')?.creditAmount).toBe(185000);
    // Must NOT post any 5XXX/6XXX expense — that was recognised by JE-17B
    expect(draft.lines.find((l) => l.accountCode?.startsWith('5'))).toBeUndefined();
    expect(draft.lines.find((l) => l.accountCode?.startsWith('6'))).toBeUndefined();
  });

  it('JE-17C: petty-cash replenishment is a single transfer JE — DR 1010 / CR 1020', () => {
    const draft = buildJE17CPettyCashReplenish({
      entryDate: new Date('2026-04-30'),
      amountPkr: 4500,
      sourceBankAccountCode: '1020',
      bookType: 'PACCI',
      userId: 'user-1',
    });
    const t = totals(draft.lines);
    expect(t.d).toBe(4500);
    expect(t.c).toBe(4500);
    expect(draft.lines.find((l) => l.accountCode === '1010')?.debitAmount).toBe(4500);
    expect(draft.lines.find((l) => l.accountCode === '1020')?.creditAmount).toBe(4500);
    // Should be exactly two lines
    expect(draft.lines.length).toBe(2);
  });

  it('JE-17C: has no source document, so it is tagged manual/acting-user, not a fabricated voucher id (P2-2)', () => {
    const draft = buildJE17CPettyCashReplenish({
      entryDate: new Date('2026-04-30'),
      amountPkr: 4500,
      sourceBankAccountCode: '1020',
      bookType: 'PACCI',
      userId: 'user-42',
    });
    expect(draft.sourceTable).toBe('manual');
    expect(draft.sourceId).toBe('user-42');
  });

  it('JE-17A handles small petty-cash voucher posting to 1010', () => {
    const draft = buildJE17AExpensePaid({
      voucherId: 'v4',
      voucherNumber: 'EXP-202604-0003',
      entryDate: new Date('2026-04-15'),
      expenseAccountCode: '6040',
      assetAccountCode: '1010', // petty cash
      amountPkr: 2500,
      bookType: 'PACCI',
    });
    expect(draft.lines.find((l) => l.accountCode === '6040')?.debitAmount).toBe(2500);
    expect(draft.lines.find((l) => l.accountCode === '1010')?.creditAmount).toBe(2500);
  });
});
