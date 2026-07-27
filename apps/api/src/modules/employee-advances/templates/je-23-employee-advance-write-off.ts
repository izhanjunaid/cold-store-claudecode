import type { JournalEntryDraft } from '../../accounting/templates/types';
import { ACCOUNT_BAD_DEBT } from '../../accounting/templates/types';

const ACCOUNT_EMPLOYEE_ADVANCES = '1230';

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
 * JE-23: Employee Advance Write-Off (bad debt).
 *
 *   DR  6080  Bad Debt Expense               outstanding_balance
 *     CR  1230  Advances to Employees          outstanding_balance
 *
 * OWNER-only. Advance transitions to WRITTEN_OFF; balance cleared. Mirrors JE-20
 * (peshgi write-off) exactly, substituting 1230 for 1140.
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
        accountCode: ACCOUNT_BAD_DEBT,
        debitAmount: amount,
        creditAmount: 0,
        description: `Bad debt expense — advance ${input.advanceNumber}`,
      },
      {
        accountCode: ACCOUNT_EMPLOYEE_ADVANCES,
        debitAmount: 0,
        creditAmount: amount,
        description: `Write off advance balance — ${input.advanceNumber}`,
      },
    ],
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
