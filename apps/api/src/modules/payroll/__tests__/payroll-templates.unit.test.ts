import { describe, it, expect } from 'vitest';
import { buildJE15Payroll } from '../templates/je-15-payroll';
import { buildJE16SalaryPayment } from '../templates/je-16-salary-payment';
import { buildJE16BGovtRemittance } from '../templates/je-16b-govt-remittance';

function totals(lines: { debitAmount: number; creditAmount: number }[]) {
  return {
    d: lines.reduce((s, l) => s + Number(l.debitAmount), 0),
    c: lines.reduce((s, l) => s + Number(l.creditAmount), 0),
  };
}

type LineOpts = { gross: number; ee?: number; er?: number; tax?: number; adv?: number; cost?: string | null };
const line = ({ gross, ee = 375, er = 1875, tax = 0, adv = 0, cost = '6010' }: LineOpts) => ({
  employeeName: 'Asif',
  costAccountCode: cost,
  gross_pay_pkr: gross,
  eobi_employee_pkr: ee,
  eobi_employer_pkr: er,
  income_tax_pkr: tax,
  advance_recovery_pkr: adv,
});

const build = (lines: ReturnType<typeof line>[], payrollType: 'MONTHLY_SALARY' | 'DAILY_WAGES' = 'MONTHLY_SALARY') =>
  buildJE15Payroll({
    payrollRunId: 'r1',
    runNumber: 'PAY-202604-001',
    payrollType,
    entryDate: new Date('2026-04-30'),
    bookType: 'PACCI',
    lines,
  });

const amount = (draft: ReturnType<typeof build>, code: string, side: 'debitAmount' | 'creditAmount') =>
  draft.lines.filter((l) => l.accountCode === code).reduce((s, l) => s + Number(l[side]), 0);

describe('Payroll JE templates', () => {
  it('JE-15 balances with EOBI and zero income tax (omits 2070 line)', () => {
    // Spec §11.3 example: 3 salaried staff, gross 105000, employee EOBI 1125, employer EOBI 5625
    const draft = build([line({ gross: 40000 }), line({ gross: 35000 }), line({ gross: 30000 })]);
    const t = totals(draft.lines);
    expect(t.d).toBe(110625);
    expect(t.c).toBe(110625);
    expect(amount(draft, '6010', 'debitAmount')).toBe(105000);
    expect(amount(draft, '6015', 'debitAmount')).toBe(5625);
    expect(amount(draft, '2030', 'creditAmount')).toBe(103875);
    expect(amount(draft, '2060', 'creditAmount')).toBe(1125);
    expect(amount(draft, '2061', 'creditAmount')).toBe(5625);
    // Spec §11.3: zero-tax line MUST be omitted
    expect(draft.lines.find((l) => l.accountCode === '2070')).toBeUndefined();
  });

  // Phase 21: net pay has the recovery subtracted, so without a matching credit line
  // the entry would be short by exactly that amount.
  it('JE-15 balances with a non-zero advance recovery, crediting 1230', () => {
    const draft = build([line({ gross: 50000, tax: 2000, adv: 5000 })]);
    const t = totals(draft.lines);
    expect(t.d).toBeCloseTo(t.c);
    expect(amount(draft, '1230', 'creditAmount')).toBe(5000);
    expect(amount(draft, '2030', 'creditAmount')).toBe(42625);
  });

  it('JE-15 omits the 1230 line when advance recovery is zero', () => {
    const draft = build([line({ gross: 50000 })]);
    expect(draft.lines.find((l) => l.accountCode === '1230')).toBeUndefined();
  });

  it('JE-15 includes 2070 line when income tax > 0', () => {
    const draft = build([line({ gross: 700000, tax: 5000 })]);
    const t = totals(draft.lines);
    expect(t.d).toBeCloseTo(t.c);
    expect(amount(draft, '2070', 'creditAmount')).toBe(5000);
  });

  it('routes direct labour to 5030 / 5035 by the employee cost account, whatever the pay type', () => {
    const draft = build([line({ gross: 30000, cost: '5030' })], 'DAILY_WAGES');
    const t = totals(draft.lines);
    expect(t.d).toBeCloseTo(t.c);
    expect(amount(draft, '5030', 'debitAmount')).toBe(30000);
    expect(amount(draft, '5035', 'debitAmount')).toBe(1875);
    expect(draft.lines.find((l) => l.accountCode === '6010')).toBeUndefined();
    expect(draft.lines.find((l) => l.accountCode === '2070')).toBeUndefined();
  });

  it('splits one run across cost accounts, each with its own employer EOBI', () => {
    const draft = build([line({ gross: 60000, cost: '5030' }), line({ gross: 40000, cost: '6010', tax: 900 })]);
    const t = totals(draft.lines);
    expect(t.d).toBeCloseTo(t.c);
    expect(amount(draft, '5030', 'debitAmount')).toBe(60000);
    expect(amount(draft, '5035', 'debitAmount')).toBe(1875);
    expect(amount(draft, '6010', 'debitAmount')).toBe(40000);
    expect(amount(draft, '6015', 'debitAmount')).toBe(1875);
    expect(amount(draft, '2070', 'creditAmount')).toBe(900);
  });

  it('refuses a line with no payroll cost account instead of guessing one', () => {
    expect(() => build([line({ gross: 1000, cost: null })])).toThrow(/cost account/);
    expect(() => build([line({ gross: 1000, cost: '4010' })])).toThrow(/cost account/);
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
