import { SYSTEM_ACCOUNTS } from '@coldchain/shared';
import type { JournalEntryDraft } from '../../accounting/templates/types';

type Input = {
  billId: string;
  billNumber: string;
  billDate: Date;
  supplier: { id: string; name: string; controlAccountCode: string };
  lines: Array<{ expenseAccountCode: string; description: string; amountPkr: number }>;
  inputTaxPkr: number;
  totalPkr: number;
  bookType: 'PACCI' | 'KATCHI';
};

/**
 * JE-32: A supplier's bill (docs/25 Q3).
 *
 *   DR  each line's expense account       line amount
 *   DR  1260 Input sales tax              input tax (if any)
 *     CR  the supplier's control account    total, with the party
 *
 * Dated at the BILL date, so the cost lands in the month it was incurred rather than
 * the month it was paid (C-02).
 */
export function buildJE32Bill(input: Input): JournalEntryDraft {
  return {
    entryType: 'BILL',
    bookType: input.bookType,
    sourceTable: 'bills',
    sourceId: input.billId,
    entryDate: input.billDate,
    description: `Bill ${input.billNumber} — ${input.supplier.name}`,
    lines: [
      ...input.lines.map((l) => ({
        accountCode: l.expenseAccountCode,
        debitAmount: l.amountPkr,
        creditAmount: 0,
        description: l.description,
      })),
      ...(input.inputTaxPkr > 0
        ? [
            {
              accountCode: SYSTEM_ACCOUNTS.INPUT_SALES_TAX,
              debitAmount: input.inputTaxPkr,
              creditAmount: 0,
              description: `Input tax on bill ${input.billNumber}`,
            },
          ]
        : []),
      {
        accountCode: input.supplier.controlAccountCode,
        debitAmount: 0,
        creditAmount: input.totalPkr,
        partyId: input.supplier.id,
        description: `Bill ${input.billNumber}`,
      },
    ],
  };
}
