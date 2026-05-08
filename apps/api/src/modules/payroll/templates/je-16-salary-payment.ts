import type { JournalEntryDraft } from '../../accounting/templates/types';

type Input = {
  payrollRunId: string;
  runNumber: string;
  entryDate: Date;
  amountPkr: number;
  fromAssetAccountCode: string; // 1010 cash or 1020 bank
  bookType: 'PACCI' | 'KATCHI';
};

/**
 * JE-16: Salary Payment.
 *
 *   DR  2030  Salaries Payable     amount_paid
 *     CR  1020  Bank Account / 1010 Cash    amount_paid
 */
export function buildJE16SalaryPayment(input: Input): JournalEntryDraft {
  const amount = round2(input.amountPkr);
  return {
    entryType: 'PAYROLL_PAYMENT',
    bookType: input.bookType,
    sourceTable: 'payroll_runs',
    sourceId: input.payrollRunId,
    entryDate: input.entryDate,
    description: `Salary payment — ${input.runNumber}`,
    lines: [
      {
        accountCode: '2030',
        debitAmount: amount,
        creditAmount: 0,
        description: `Settle salaries payable — ${input.runNumber}`,
      },
      {
        accountCode: input.fromAssetAccountCode,
        debitAmount: 0,
        creditAmount: amount,
        description: `Cash/bank disbursement — ${input.runNumber}`,
      },
    ],
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
