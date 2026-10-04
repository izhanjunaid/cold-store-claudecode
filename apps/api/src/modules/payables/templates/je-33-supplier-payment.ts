import type { JournalEntryDraft } from '../../accounting/templates/types';

type Input = {
  paymentId: string;
  paymentNumber: string;
  paymentDate: Date;
  supplier: { id: string; name: string; controlAccountCode: string };
  assetAccountCode: string;
  grossPkr: number;
  netPkr: number;
  withholding: { accountCode: string; amountPkr: number; section: string } | null;
  bookType: 'PACCI' | 'KATCHI';
};

/**
 * JE-33: A payment to a supplier (docs/25 Q3, C-09).
 *
 *   DR  the supplier's control account    gross, with the party
 *     CR  a cash equivalent                 net (what the supplier receives)
 *     CR  2071 / 2072 tax withheld          withholding, owed to the FBR
 *
 * The gross settles what the facility owes; withholding splits how it is settled, it
 * does not reduce it.
 */
export function buildJE33SupplierPayment(input: Input): JournalEntryDraft {
  return {
    entryType: 'SUPPLIER_PAYMENT',
    bookType: input.bookType,
    sourceTable: 'supplier_payments',
    sourceId: input.paymentId,
    entryDate: input.paymentDate,
    description: `Payment ${input.paymentNumber} — ${input.supplier.name}`,
    lines: [
      {
        accountCode: input.supplier.controlAccountCode,
        debitAmount: input.grossPkr,
        creditAmount: 0,
        partyId: input.supplier.id,
        description: `Payment ${input.paymentNumber}`,
      },
      {
        accountCode: input.assetAccountCode,
        debitAmount: 0,
        creditAmount: input.netPkr,
        description: `Paid to ${input.supplier.name}`,
      },
      ...(input.withholding && input.withholding.amountPkr > 0
        ? [
            {
              accountCode: input.withholding.accountCode,
              debitAmount: 0,
              creditAmount: input.withholding.amountPkr,
              description: `Tax withheld (${input.withholding.section}) from ${input.supplier.name}`,
            },
          ]
        : []),
    ],
  };
}
