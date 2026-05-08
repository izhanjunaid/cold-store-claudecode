import type { JournalEntryDraft, JournalEntryLineDraft } from '../../accounting/templates/types';

type Input = {
  payrollRunId: string;
  runNumber: string;
  entryDate: Date;
  totalGrossPkr: number;
  totalEmployerEobiPkr: number;
  totalEmployeeEobiPkr: number;
  totalIncomeTaxPkr: number;
  totalNetPayablePkr: number;
  bookType: 'PACCI' | 'KATCHI';
};

/**
 * JE-15: Monthly Salary Payroll Run (SALARIED staff).
 *
 *   DR  6010  Salaries — Mgmt & Office       gross
 *   DR  6015  Employer EOBI — Mgmt           employer_eobi
 *     CR  2030  Salaries Payable               net_payable
 *     CR  2060  EOBI Payable (Employee)        employee_eobi
 *     CR  2061  EOBI Payable (Employer)        employer_eobi
 *     CR  2070  Income Tax Withheld Payable    tax (if > 0; omit if zero per spec §11.3)
 *
 * Net Payable = Gross − Employee EOBI − Income Tax
 */
export function buildJE15MonthlyPayroll(input: Input): JournalEntryDraft {
  const lines: JournalEntryLineDraft[] = [];
  const gross = round2(input.totalGrossPkr);
  const employerEobi = round2(input.totalEmployerEobiPkr);
  const employeeEobi = round2(input.totalEmployeeEobiPkr);
  const tax = round2(input.totalIncomeTaxPkr);
  const netPayable = round2(input.totalNetPayablePkr);

  lines.push({
    accountCode: '6010',
    debitAmount: gross,
    creditAmount: 0,
    description: `Salaries — ${input.runNumber}`,
  });

  if (employerEobi > 0) {
    lines.push({
      accountCode: '6015',
      debitAmount: employerEobi,
      creditAmount: 0,
      description: `Employer EOBI — ${input.runNumber}`,
    });
  }

  lines.push({
    accountCode: '2030',
    debitAmount: 0,
    creditAmount: netPayable,
    description: `Salaries Payable — ${input.runNumber}`,
  });

  if (employeeEobi > 0) {
    lines.push({
      accountCode: '2060',
      debitAmount: 0,
      creditAmount: employeeEobi,
      description: `Employee EOBI deducted — ${input.runNumber}`,
    });
  }

  if (employerEobi > 0) {
    lines.push({
      accountCode: '2061',
      debitAmount: 0,
      creditAmount: employerEobi,
      description: `Employer EOBI payable — ${input.runNumber}`,
    });
  }

  // Spec §11.3: omit zero-tax line entirely
  if (tax > 0) {
    lines.push({
      accountCode: '2070',
      debitAmount: 0,
      creditAmount: tax,
      description: `Income tax withheld — ${input.runNumber}`,
    });
  }

  return {
    entryType: 'PAYROLL',
    bookType: input.bookType,
    sourceTable: 'payroll_runs',
    sourceId: input.payrollRunId,
    entryDate: input.entryDate,
    description: `Payroll run ${input.runNumber} — monthly salaries`,
    lines,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
