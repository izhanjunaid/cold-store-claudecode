import { SYSTEM_ACCOUNTS } from '@coldchain/shared';
import type { JournalEntryDraft } from '../../accounting/templates/types';

type Input = {
  billId: string;
  billNumber: string;
  voucherNumber: string;
  conversionDate: Date;
  supplier: { id: string; name: string; controlAccountCode: string };
  amountPkr: number;
  bookType: 'PACCI' | 'KATCHI';
};

/**
 * JE-35: An accrued expense voucher becomes a supplier's bill (docs/25 C-03).
 *
 *   DR  2040 Accrued expenses (legacy)     voucher amount
 *     CR  the supplier's control account     same, with the party
 *
 * The cost was recognised when the voucher was accrued (JE-17B); this only moves the
 * liability onto the supplier's account so it is paid and aged like any bill.
 */
export function buildJE35VoucherConversion(input: Input): JournalEntryDraft {
  return {
    entryType: 'BILL',
    bookType: input.bookType,
    sourceTable: 'bills',
    sourceId: input.billId,
    entryDate: input.conversionDate,
    description: `Expense voucher ${input.voucherNumber} converted to bill ${input.billNumber} — ${input.supplier.name}`,
    lines: [
      {
        accountCode: SYSTEM_ACCOUNTS.UTILITY_BILLS_PAYABLE,
        debitAmount: input.amountPkr,
        creditAmount: 0,
        description: `Voucher ${input.voucherNumber} moved to ${input.supplier.name}`,
      },
      {
        accountCode: input.supplier.controlAccountCode,
        debitAmount: 0,
        creditAmount: input.amountPkr,
        partyId: input.supplier.id,
        description: `Bill ${input.billNumber} (from voucher ${input.voucherNumber})`,
      },
    ],
  };
}
