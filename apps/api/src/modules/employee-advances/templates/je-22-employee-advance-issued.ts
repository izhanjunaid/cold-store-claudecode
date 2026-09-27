import { SYSTEM_ACCOUNTS, round2 } from '@coldchain/shared';
import type { JournalEntryDraft } from '../../accounting/templates/types';

type Input = {
  advanceId: string;
  advanceNumber: string;
  employeeName: string;
  entryDate: Date;
  amountPkr: number;
  fromAssetAccountCode: string;
  bookType: 'PACCI' | 'KATCHI';
};

/**
 * JE-22: Employee Advance Issued.
 *
 *   DR  1230  Advances to Employees      amount
 *     CR  1010 / 1020  Cash / Bank         amount
 *
 * No partyId on either line — this is an employee receivable, not a party one, and
 * JournalEntryLineDraft has no employee dimension (audit finding: no per-employee
 * subledger exists on payroll postings either; this mirrors that limitation rather
 * than inventing a new one).
 */
export function buildJE22EmployeeAdvanceIssued(input: Input): JournalEntryDraft {
  const amount = round2(input.amountPkr);
  return {
    entryType: 'EMPLOYEE_ADVANCE_ISSUE',
    bookType: input.bookType,
    sourceTable: 'employee_advances',
    sourceId: input.advanceId,
    entryDate: input.entryDate,
    description: `Advance ${input.advanceNumber} — issued to ${input.employeeName}`,
    lines: [
      {
        accountCode: SYSTEM_ACCOUNTS.EMPLOYEE_ADVANCES,
        debitAmount: amount,
        creditAmount: 0,
        description: `Advance to ${input.employeeName} — ${input.advanceNumber}`,
      },
      {
        accountCode: input.fromAssetAccountCode,
        debitAmount: 0,
        creditAmount: amount,
        description: `Disburse advance ${input.advanceNumber}`,
      },
    ],
  };
}
