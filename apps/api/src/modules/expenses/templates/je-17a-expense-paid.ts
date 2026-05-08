import type { JournalEntryDraft } from '../../accounting/templates/types';

type Input = {
  voucherId: string;
  voucherNumber: string;
  entryDate: Date;
  expenseAccountCode: string;
  assetAccountCode: string;
  amountPkr: number;
  bookType: 'PACCI' | 'KATCHI';
  description?: string;
};

/**
 * JE-17A: Expense Paid Immediately (cash or bank).
 *
 *   DR  5XXX / 6XXX  Expense Account   amount
 *     CR  1010 / 1020   Cash / Bank       amount
 */
export function buildJE17AExpensePaid(input: Input): JournalEntryDraft {
  const amount = round2(input.amountPkr);
  return {
    entryType: 'EXPENSE',
    bookType: input.bookType,
    sourceTable: 'expense_vouchers',
    sourceId: input.voucherId,
    entryDate: input.entryDate,
    description: input.description ?? `Expense voucher ${input.voucherNumber}`,
    lines: [
      {
        accountCode: input.expenseAccountCode,
        debitAmount: amount,
        creditAmount: 0,
        description: `Expense — ${input.voucherNumber}`,
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
