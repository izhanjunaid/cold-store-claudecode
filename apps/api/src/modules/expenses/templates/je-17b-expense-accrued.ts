import type { JournalEntryDraft } from '../../accounting/templates/types';

type Input = {
  voucherId: string;
  voucherNumber: string;
  entryDate: Date;
  expenseAccountCode: string;
  amountPkr: number;
  bookType: 'PACCI' | 'KATCHI';
};

/**
 * JE-17B: Expense Accrued (bill received, not yet paid).
 *
 *   DR  5XXX / 6XXX  Expense Account     amount
 *     CR  2040  Utility Bills Payable      amount
 */
export function buildJE17BExpenseAccrued(input: Input): JournalEntryDraft {
  const amount = round2(input.amountPkr);
  return {
    entryType: 'EXPENSE',
    bookType: input.bookType,
    sourceTable: 'expense_vouchers',
    sourceId: input.voucherId,
    entryDate: input.entryDate,
    description: `Accrued expense — ${input.voucherNumber}`,
    lines: [
      {
        accountCode: input.expenseAccountCode,
        debitAmount: amount,
        creditAmount: 0,
        description: `Expense accrued — ${input.voucherNumber}`,
      },
      {
        accountCode: '2040',
        debitAmount: 0,
        creditAmount: amount,
        description: `Bill payable — ${input.voucherNumber}`,
      },
    ],
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
