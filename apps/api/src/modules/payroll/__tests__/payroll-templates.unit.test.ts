import { describe, it, expect } from 'vitest';
import { buildJE15MonthlyPayroll } from '../templates/je-15-monthly-payroll';
import { buildJE15BDailyWages } from '../templates/je-15b-daily-wages';
import { buildJE16SalaryPayment } from '../templates/je-16-salary-payment';
import { buildJE16BGovtRemittance } from '../templates/je-16b-govt-remittance';

function totals(lines: { debitAmount: number; creditAmount: number }[]) {
  return {
    d: lines.reduce((s, l) => s + Number(l.debitAmount), 0),
    c: lines.reduce((s, l) => s + Number(l.creditAmount), 0),
  };
}

describe('Payroll JE templates', () => {
  it('JE-15 balances with EOBI and zero income tax (omits 2070 line)', () => {
    // Spec §11.3 example: 3 salaried staff, gross 105000, employee EOBI 1125, employer EOBI 5625
    const draft = buildJE15MonthlyPayroll({
      payrollRunId: 'r1',
      runNumber: 'PAY-202604-001',
      entryDate: new Date('2026-04-30'),
      totalGrossPkr: 105000,
      totalEmployerEobiPkr: 5625,
      totalEmployeeEobiPkr: 1125,
      totalIncomeTaxPkr: 0,
      totalNetPayablePkr: 103875,
      bookType: 'PACCI',
    });
    const t = totals(draft.lines);
    expect(t.d).toBe(110625);
    expect(t.c).toBe(110625);
    expect(draft.lines.find((l) => l.accountCode === '6010')?.debitAmount).toBe(105000);
    expect(draft.lines.find((l) => l.accountCode === '6015')?.debitAmount).toBe(5625);
    expect(draft.lines.find((l) => l.accountCode === '2030')?.creditAmount).toBe(103875);
    expect(draft.lines.find((l) => l.accountCode === '2060')?.creditAmount).toBe(1125);
    expect(draft.lines.find((l) => l.accountCode === '2061')?.creditAmount).toBe(5625);
    // Spec §11.3: zero-tax line MUST be omitted
    expect(draft.lines.find((l) => l.accountCode === '2070')).toBeUndefined();
  });

  it('JE-15 includes 2070 line when income tax > 0', () => {
    const draft = buildJE15MonthlyPayroll({
      payrollRunId: 'r2',
      runNumber: 'PAY-202604-002',
      entryDate: new Date('2026-04-30'),
      totalGrossPkr: 700000,
      totalEmployerEobiPkr: 1875,
      totalEmployeeEobiPkr: 375,
      totalIncomeTaxPkr: 5000,
      totalNetPayablePkr: 694625, // 700k - 375 - 5000
      bookType: 'PACCI',
    });
    const t = totals(draft.lines);
    expect(t.d).toBeCloseTo(t.c);
    expect(draft.lines.find((l) => l.accountCode === '2070')?.creditAmount).toBe(5000);
  });

  it('JE-15B routes daily wages to 5030 / 5035 (cost of service, not 6010)', () => {
    const draft = buildJE15BDailyWages({
      payrollRunId: 'r3',
      runNumber: 'PAY-202604-DW01',
      entryDate: new Date('2026-04-30'),
      totalGrossPkr: 30000,
      totalEmployerEobiPkr: 1875,
      totalEmployeeEobiPkr: 375,
      totalNetPayablePkr: 29625,
      bookType: 'PACCI',
    });
    const t = totals(draft.lines);
    expect(t.d).toBeCloseTo(t.c);
    expect(draft.lines.find((l) => l.accountCode === '5030')?.debitAmount).toBe(30000);
    expect(draft.lines.find((l) => l.accountCode === '5035')?.debitAmount).toBe(1875);
    // Should NOT post to 6010 (that's salaried staff only)
    expect(draft.lines.find((l) => l.accountCode === '6010')).toBeUndefined();
  });

  it('JE-16 balances: DR Salaries Payable, CR Bank', () => {
    const draft = buildJE16SalaryPayment({
      payrollRunId: 'r4',
      runNumber: 'PAY-202604-001',
      entryDate: new Date('2026-05-01'),
      amountPkr: 103875,
      fromAssetAccountCode: '1020',
      bookType: 'PACCI',
    });
    const t = totals(draft.lines);
    expect(t.d).toBe(103875);
    expect(t.c).toBe(103875);
    expect(draft.lines.find((l) => l.accountCode === '2030')?.debitAmount).toBe(103875);
    expect(draft.lines.find((l) => l.accountCode === '1020')?.creditAmount).toBe(103875);
    expect(draft.entryType).toBe('PAYROLL_PAYMENT');
  });

  it('JE-16B balances with EOBI + tax remittance', () => {
    const draft = buildJE16BGovtRemittance({
      payrollRunId: 'r5',
      runNumber: 'PAY-202604-001',
      entryDate: new Date('2026-05-15'),
      employeeEobiPkr: 1125,
      employerEobiPkr: 5625,
      incomeTaxPkr: 5000,
      fromAssetAccountCode: '1020',
      bookType: 'PACCI',
    });
    const t = totals(draft.lines);
    expect(t.d).toBe(11750);
    expect(t.c).toBe(11750);
    expect(draft.entryType).toBe('GOVT_REMITTANCE');
  });

  it('JE-16B handles partial remittance (no tax line if zero)', () => {
    const draft = buildJE16BGovtRemittance({
      payrollRunId: 'r6',
      runNumber: 'PAY-202604-002',
      entryDate: new Date('2026-05-15'),
      employeeEobiPkr: 375,
      employerEobiPkr: 1875,
      incomeTaxPkr: 0,
      fromAssetAccountCode: '1020',
      bookType: 'PACCI',
    });
    const t = totals(draft.lines);
    expect(t.d).toBeCloseTo(t.c);
    expect(draft.lines.find((l) => l.accountCode === '2070')).toBeUndefined();
  });
});
