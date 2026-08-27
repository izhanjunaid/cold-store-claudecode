import type { JournalEntryDraft } from '../../accounting/templates/types';

type Input = {
  voucherId: string;
  voucherNumber: string;
  entryDate: Date;
  assetAccountCode: string;
  amountPkr: number;
  bookType: 'PACCI' | 'KATCHI';
  /** Tax deducted at source from this payment. Zero for almost every voucher. */
  taxWithheldPkr?: number;
  /** 2071 (s.153) or 2072 (s.155). Required when taxWithheldPkr > 0. */
  withholdingAccountCode?: string;
};

/**
 * JE-17B-PAY: Payment of Previously Accrued Expense.
 * Clears the liability created by JE-17B; no new expense recognized.
 *
 *   DR  2040  Utility Bills Payable     amount
 *     CR  2071 / 2072  Tax withheld        withheld (if any)
 *     CR  1010 / 1020  Cash / Bank         amount − withheld
 *
 * The liability clears in full: the supplier's claim is settled whether the
 * money goes to them or to the tax authority on their behalf.
 */
export function buildJE17BPayAccruedExpense(input: Input): JournalEntryDraft {
  const amount = round2(input.amountPkr);
  const withheld = round2(input.taxWithheldPkr ?? 0);
  const net = round2(amount - withheld);
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
      ...(withheld > 0
        ? [
            {
              accountCode: input.withholdingAccountCode!,
              debitAmount: 0,
              creditAmount: withheld,
              description: `Tax withheld — ${input.voucherNumber}`,
            },
          ]
        : []),
      {
        accountCode: input.assetAccountCode,
        debitAmount: 0,
        creditAmount: net,
        description: `Payment — ${input.voucherNumber}`,
      },
    ],
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
