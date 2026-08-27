import type { JournalEntryDraft } from '../../accounting/templates/types';

type Input = {
  voucherId: string;
  voucherNumber: string;
  entryDate: Date;
  expenseAccountCode: string;
  assetAccountCode: string;
  amountPkr: number;
  bookType: 'PACCI' | 'KATCHI';
  /** Tax deducted at source from this payment. Zero for almost every voucher. */
  taxWithheldPkr?: number;
  /** 2071 (s.153) or 2072 (s.155). Required when taxWithheldPkr > 0. */
  withholdingAccountCode?: string;
  description?: string;
};

/**
 * JE-17A: Expense Paid Immediately (cash or bank).
 *
 *   DR  5XXX / 6XXX  Expense Account   amount
 *     CR  2071 / 2072   Tax withheld        withheld (if any)
 *     CR  1010 / 1020   Cash / Bank         amount − withheld
 *
 * The expense is the GROSS amount — that is what the supplier earned and what
 * the facility is liable for. Withholding does not reduce the cost; it splits
 * how it is settled, part to the supplier and part to the tax authority.
 */
export function buildJE17AExpensePaid(input: Input): JournalEntryDraft {
  const amount = round2(input.amountPkr);
  const withheld = round2(input.taxWithheldPkr ?? 0);
  const net = round2(amount - withheld);
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
