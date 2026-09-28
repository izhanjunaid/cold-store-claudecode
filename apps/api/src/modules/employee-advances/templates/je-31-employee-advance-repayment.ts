import { SYSTEM_ACCOUNTS, round2 } from '@coldchain/shared';
import type { JournalEntryDraft } from '../../accounting/templates/types';

type Input = {
  recoveryId: string;
  advanceNumber: string;
  employeeName: string;
  entryDate: Date;
  amountPkr: number;
  toAssetAccountCode: string;
  bookType: 'PACCI' | 'KATCHI';
};

/**
 * JE-31: Employee Advance Repaid in Cash (docs/25 C-26).
 *
 *   DR  cash / bank account             amount
 *     CR  1230  Advances to Employees     amount
 *
 * Sourced to the recovery row, so voiding the repayment reverses exactly this
 * entry. A payroll deduction needs no entry of its own — it rides inside JE-15.
 */
export function buildJE31EmployeeAdvanceRepayment(input: Input): JournalEntryDraft {
  const amount = round2(input.amountPkr);
  return {
    entryType: 'EMPLOYEE_ADVANCE_REPAYMENT',
    bookType: input.bookType,
    sourceTable: 'employee_advance_recoveries',
    sourceId: input.recoveryId,
    entryDate: input.entryDate,
    description: `Advance ${input.advanceNumber} — repaid in cash by ${input.employeeName}`,
    lines: [
      {
        accountCode: input.toAssetAccountCode,
        debitAmount: amount,
        creditAmount: 0,
        description: `Repayment received — ${input.advanceNumber}`,
      },
      {
        accountCode: SYSTEM_ACCOUNTS.EMPLOYEE_ADVANCES,
        debitAmount: 0,
        creditAmount: amount,
        description: `Advance repaid — ${input.advanceNumber}`,
      },
    ],
  };
}
