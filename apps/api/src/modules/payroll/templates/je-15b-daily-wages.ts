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
 * JE-15B: Daily Wages Payroll Run.
 *
 *   DR  5030  Direct Labor — Loaders & Handlers     gross
 *   DR  5035  Employer EOBI — Direct Labor          employer_eobi
 *     CR  2030  Salaries Payable                      net_payable
 *     CR  2060  EOBI Payable (Employee)               employee_eobi
 *     CR  2061  EOBI Payable (Employer)               employer_eobi
 *     CR  2070  Income Tax Withheld Payable           tax (if > 0; omit if zero per spec §11.3)
 *
 * Net Payable = Gross − Employee EOBI − Income Tax
 *
 * Direct labor posts to 5030 (Cost of Service, affects Gross Profit)
 * and Employer EOBI posts to 5035 (also Cost of Service per spec §11.3).
 */
export function buildJE15BDailyWages(input: Input): JournalEntryDraft {
  const lines: JournalEntryLineDraft[] = [];
  const gross = round2(input.totalGrossPkr);
  const employerEobi = round2(input.totalEmployerEobiPkr);
  const employeeEobi = round2(input.totalEmployeeEobiPkr);
  const incomeTax = round2(input.totalIncomeTaxPkr);
  const netPayable = round2(input.totalNetPayablePkr);

  lines.push({
    accountCode: '5030',
    debitAmount: gross,
    creditAmount: 0,
    description: `Direct labor — ${input.runNumber}`,
  });

  if (employerEobi > 0) {
    lines.push({
      accountCode: '5035',
      debitAmount: employerEobi,
      creditAmount: 0,
      description: `Employer EOBI (direct labor) — ${input.runNumber}`,
    });
  }

  lines.push({
    accountCode: '2030',
    debitAmount: 0,
    creditAmount: netPayable,
    description: `Wages Payable — ${input.runNumber}`,
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

  // Net pay already has income tax deducted, so without this line the entry is short
  // by exactly the tax and a daily-wage run carrying tax could never be finalized.
  if (incomeTax > 0) {
    lines.push({
      accountCode: '2070',
      debitAmount: 0,
      creditAmount: incomeTax,
      description: `Income tax withheld — ${input.runNumber}`,
    });
  }

  return {
    entryType: 'PAYROLL',
    bookType: input.bookType,
    sourceTable: 'payroll_runs',
    sourceId: input.payrollRunId,
    entryDate: input.entryDate,
    description: `Payroll run ${input.runNumber} — daily wages`,
    lines,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
