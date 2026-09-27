import type { JournalEntryDraft } from '../../accounting/templates/types';
import { SYSTEM_ACCOUNTS, round2 } from '@coldchain/shared';

type Input = {
  advanceId: string;
  advanceNumber: string;
  employeeName: string;
  entryDate: Date;
  amountPkr: number;
  reason: string;
  bookType: 'PACCI' | 'KATCHI';
};

/**
 * JE-23: Employee Advance Write-Off.
 *
 *   DR  6190  Staff Welfare & Benefits       outstanding_balance
 *     CR  1230  Advances to Employees          outstanding_balance
 *
 * Forgiving an employee's advance is a benefit given to staff, not a customer bad
 * debt — it used to debit 6080 and inflate bad debts (docs/25 C-27). The advance
 * transitions to WRITTEN_OFF; balance cleared.
 */
export function buildJE23EmployeeAdvanceWriteOff(input: Input): JournalEntryDraft {
  const amount = round2(input.amountPkr);
  return {
    entryType: 'EMPLOYEE_ADVANCE_WRITE_OFF',
    bookType: input.bookType,
    sourceTable: 'employee_advances',
    sourceId: input.advanceId,
    entryDate: input.entryDate,
    description: `Advance write-off — ${input.advanceNumber} (${input.employeeName}): ${input.reason}`,
    lines: [
      {
        accountCode: SYSTEM_ACCOUNTS.STAFF_BENEFITS,
        debitAmount: amount,
        creditAmount: 0,
        description: `Advance forgiven — ${input.advanceNumber}`,
      },
      {
        accountCode: SYSTEM_ACCOUNTS.EMPLOYEE_ADVANCES,
        debitAmount: 0,
        creditAmount: amount,
        description: `Write off advance balance — ${input.advanceNumber}`,
      },
    ],
  };
}
