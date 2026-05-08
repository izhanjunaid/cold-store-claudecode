import type { JournalEntryDraft } from '../../accounting/templates/types';

type Input = {
  entryDate: Date;
  amountPkr: number;
  sourceBankAccountCode: string;
  bookType: 'PACCI' | 'KATCHI';
  reference: string; // identifier to use as sourceId
};

/**
 * JE-17C: Petty Cash Float Replenishment.
 *
 * Per plan: petty cash spending is recorded as ordinary JE-17A vouchers
 * (DR 6XXX / CR 1010). JE-17C only restores the float:
 *
 *   DR  1010  Cash on Hand        amount
 *     CR  1020  Bank Account        amount
 */
export function buildJE17CPettyCashReplenish(input: Input): JournalEntryDraft {
  const amount = round2(input.amountPkr);
  return {
    entryType: 'EXPENSE',
    bookType: input.bookType,
    sourceTable: 'expense_vouchers',
    sourceId: input.reference,
    entryDate: input.entryDate,
    description: `Petty cash replenishment Rs. ${amount.toLocaleString()}`,
    lines: [
      {
        accountCode: '1010',
        debitAmount: amount,
        creditAmount: 0,
        description: 'Petty cash float restoration',
      },
      {
        accountCode: input.sourceBankAccountCode,
        debitAmount: 0,
        creditAmount: amount,
        description: 'Withdraw from bank for petty cash',
      },
    ],
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
