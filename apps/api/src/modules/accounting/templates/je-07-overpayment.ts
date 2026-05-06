import type { JournalEntryDraft } from './types';
import { arAccountForParty, assetAccountForPaymentMethod, ACCOUNT_ADVANCE_RECEIPTS } from './types';

type Input = {
  paymentId: string;
  paymentDate: Date;
  paymentMethod: string;
  bookType: 'PACCI' | 'KATCHI';
  party: { id: string; partyType: string; name: string };
  appliedAmountPkr: number;
  overpaymentAmountPkr: number;
  assetAccountCode?: string | null;
};

/**
 * JE-07: Overpayment — Client Credit Balance.
 *
 *   DR  1010/1020 Cash/Bank                 full_payment
 *     CR  1110/1120/1130 Receivable — Type    invoice_balance (applied)
 *     CR  2010 Advance Receipts from Clients  overpayment
 *
 * Used when a single payment over-allocates and the excess sits as a future credit.
 */
export function buildJE07Overpayment(input: Input): JournalEntryDraft {
  const arAccount = arAccountForParty(input.party.partyType);
  const assetAccount =
    input.assetAccountCode ?? assetAccountForPaymentMethod(input.paymentMethod);
  const total = round2(input.appliedAmountPkr + input.overpaymentAmountPkr);

  return {
    entryType: 'PAYMENT',
    bookType: input.bookType,
    sourceTable: 'payments',
    sourceId: input.paymentId,
    entryDate: input.paymentDate,
    description: `Payment with overpayment from ${input.party.name}`,
    lines: [
      {
        accountCode: assetAccount,
        debitAmount: total,
        creditAmount: 0,
        partyId: input.party.id,
        description: `${input.paymentMethod} from ${input.party.name}`,
      },
      {
        accountCode: arAccount,
        debitAmount: 0,
        creditAmount: round2(input.appliedAmountPkr),
        partyId: input.party.id,
        description: `Settle AR portion — ${input.party.name}`,
      },
      {
        accountCode: ACCOUNT_ADVANCE_RECEIPTS,
        debitAmount: 0,
        creditAmount: round2(input.overpaymentAmountPkr),
        partyId: input.party.id,
        description: `Overpayment held as advance — ${input.party.name}`,
      },
    ],
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
