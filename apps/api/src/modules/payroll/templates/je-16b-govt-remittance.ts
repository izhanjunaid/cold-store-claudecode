import type { JournalEntryDraft, JournalEntryLineDraft } from '../../accounting/templates/types';

type Input = {
  payrollRunId: string;
  runNumber: string;
  entryDate: Date;
  employeeEobiPkr: number;
  employerEobiPkr: number;
  incomeTaxPkr: number;
  fromAssetAccountCode: string;
  bookType: 'PACCI' | 'KATCHI';
};

/**
 * JE-16B: EOBI / Tax Remittance to Government.
 *
 *   DR  2060  EOBI Payable — Employee Portion    employee_eobi
 *   DR  2061  EOBI Payable — Employer Portion    employer_eobi
 *   DR  2070  Income Tax Withheld Payable         tax (if > 0)
 *     CR  1020  Bank Account — Main                total_remittance
 */
export function buildJE16BGovtRemittance(input: Input): JournalEntryDraft {
  const lines: JournalEntryLineDraft[] = [];
  const employeeEobi = round2(input.employeeEobiPkr);
  const employerEobi = round2(input.employerEobiPkr);
  const tax = round2(input.incomeTaxPkr);
  const total = round2(employeeEobi + employerEobi + tax);

  if (employeeEobi > 0) {
    lines.push({
      accountCode: '2060',
      debitAmount: employeeEobi,
      creditAmount: 0,
      description: `Remit Employee EOBI — ${input.runNumber}`,
    });
  }
  if (employerEobi > 0) {
    lines.push({
      accountCode: '2061',
      debitAmount: employerEobi,
      creditAmount: 0,
      description: `Remit Employer EOBI — ${input.runNumber}`,
    });
  }
  if (tax > 0) {
    lines.push({
      accountCode: '2070',
      debitAmount: tax,
      creditAmount: 0,
      description: `Remit Income Tax Withheld — ${input.runNumber}`,
    });
  }

  lines.push({
    accountCode: input.fromAssetAccountCode,
    debitAmount: 0,
    creditAmount: total,
    description: `Govt remittance — ${input.runNumber}`,
  });

  return {
    entryType: 'GOVT_REMITTANCE',
    bookType: input.bookType,
    sourceTable: 'payroll_runs',
    sourceId: input.payrollRunId,
    entryDate: input.entryDate,
    description: `EOBI/tax remittance — ${input.runNumber}`,
    lines,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
