import {
  PAYROLL_COST_ACCOUNTS,
  SYSTEM_ACCOUNTS,
  payrollRunTotals,
  sumMoney,
  type PayrollLineAmounts,
} from '@coldchain/shared';
import type { JournalEntryDraft, JournalEntryLineDraft } from '../../accounting/templates/types';
import { Errors } from '../../../common/errors';

type Input = {
  payrollRunId: string;
  runNumber: string;
  payrollType: 'MONTHLY_SALARY' | 'DAILY_WAGES';
  entryDate: Date;
  bookType: 'PACCI' | 'KATCHI';
  lines: Array<PayrollLineAmounts & { employeeName: string; costAccountCode: string | null }>;
};

/**
 * JE-15: Payroll accrual — one builder for salaries and daily wages (docs/25 C-16).
 *
 *   DR  each employee's cost account (6010 office / 5030 direct labour)   gross
 *   DR  the employer-EOBI account paired with it (6015 / 5035)            employer EOBI
 *     CR  2030  Salaries Payable                                            net pay
 *     CR  2060  EOBI Payable — Employee                                     employee EOBI
 *     CR  2061  EOBI Payable — Employer                                     employer EOBI
 *     CR  2070  Income Tax Withheld                                         tax (omitted when zero)
 *     CR  1230  Advances to Employees                                       advance recovery (omitted when zero)
 *
 * Cost follows what the employee does, stored on the employee — it used to follow how
 * they were paid, so a salaried plant operator landed in overheads.
 */
export function buildJE15Payroll(input: Input): JournalEntryDraft {
  const byCostAccount = new Map<string, typeof input.lines>();
  for (const l of input.lines) {
    if (!l.costAccountCode || !(l.costAccountCode in PAYROLL_COST_ACCOUNTS)) {
      throw Errors.VALIDATION_ERROR(
        `${l.employeeName} has no payroll cost account (${l.costAccountCode ?? 'none'}); set one on the employee`,
      );
    }
    byCostAccount.set(l.costAccountCode, [...(byCostAccount.get(l.costAccountCode) ?? []), l]);
  }

  const lines: JournalEntryLineDraft[] = [];
  for (const [costAccount, group] of [...byCostAccount].sort(([a], [b]) => a.localeCompare(b))) {
    const gross = sumMoney(group.map((l) => l.gross_pay_pkr));
    const employerEobi = sumMoney(group.map((l) => l.eobi_employer_pkr));
    if (gross > 0) {
      lines.push({ accountCode: costAccount, debitAmount: gross, creditAmount: 0, description: `Pay — ${input.runNumber}` });
    }
    if (employerEobi > 0) {
      lines.push({
        accountCode: PAYROLL_COST_ACCOUNTS[costAccount as keyof typeof PAYROLL_COST_ACCOUNTS].employerEobi,
        debitAmount: employerEobi,
        creditAmount: 0,
        description: `Employer EOBI — ${input.runNumber}`,
      });
    }
  }

  const t = payrollRunTotals(input.lines);
  const credit = (accountCode: string, amount: number, description: string) => {
    if (amount > 0) lines.push({ accountCode, debitAmount: 0, creditAmount: amount, description });
  };
  credit(SYSTEM_ACCOUNTS.SALARIES_PAYABLE, t.net, `Salaries payable — ${input.runNumber}`);
  credit(SYSTEM_ACCOUNTS.EOBI_EMPLOYEE, t.employeeEobi, `Employee EOBI deducted — ${input.runNumber}`);
  credit(SYSTEM_ACCOUNTS.EOBI_EMPLOYER, t.employerEobi, `Employer EOBI payable — ${input.runNumber}`);
  credit(SYSTEM_ACCOUNTS.WHT_SALARIES, t.incomeTax, `Income tax withheld — ${input.runNumber}`);
  // Recovery reduces the employee's receivable, not a liability (docs/18 §4).
  credit(SYSTEM_ACCOUNTS.EMPLOYEE_ADVANCES, t.advanceRecovery, `Advance recovery — ${input.runNumber}`);

  return {
    entryType: 'PAYROLL',
    bookType: input.bookType,
    sourceTable: 'payroll_runs',
    sourceId: input.payrollRunId,
    entryDate: input.entryDate,
    description: `Payroll run ${input.runNumber} — ${input.payrollType === 'MONTHLY_SALARY' ? 'monthly salaries' : 'daily wages'}`,
    lines,
  };
}
