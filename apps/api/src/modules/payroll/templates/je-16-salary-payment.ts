import { SYSTEM_ACCOUNTS, round2 } from '@coldchain/shared';
import type { JournalEntryDraft } from '../../accounting/templates/types';

type Input = {
  payrollRunId: string;
  runNumber: string;
  entryDate: Date;
  amountPkr: number;
  fromAssetAccountCode: string;
  bookType: 'PACCI' | 'KATCHI';
};

/**
 * JE-16: Salary Payment.
 *
 *   DR  2030  Salaries Payable        amount_paid
 *     CR  cash / bank account          amount_paid
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
        accountCode: SYSTEM_ACCOUNTS.SALARIES_PAYABLE,
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
