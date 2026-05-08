import type { JournalEntryDraft } from '../../accounting/templates/types';

type Input = {
  voucherId: string;
  voucherNumber: string;
  entryDate: Date;
  assetAccountCode: string;
  amountPkr: number;
  bookType: 'PACCI' | 'KATCHI';
};

/**
 * JE-17B-PAY: Payment of Previously Accrued Expense.
 * Clears the liability created by JE-17B; no new expense recognized.
 *
 *   DR  2040  Utility Bills Payable     amount
 *     CR  1010 / 1020  Cash / Bank        amount
 */
export function buildJE17BPayAccruedExpense(input: Input): JournalEntryDraft {
  const amount = round2(input.amountPkr);
  return {
    entryType: 'EXPENSE',
    bookType: input.bookType,
    sourceTable: 'expense_vouchers',
    sourceId: input.voucherId,
    entryDate: input.entryDate,
    description: `Pay accrued expense — ${input.voucherNumber}`,
    lines: [
      {
        accountCode: '2040',
        debitAmount: amount,
        creditAmount: 0,
        description: `Settle bill payable — ${input.voucherNumber}`,
      },
      {
        accountCode: input.assetAccountCode,
        debitAmount: 0,
        creditAmount: amount,
        description: `Payment — ${input.voucherNumber}`,
      },
    ],
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
