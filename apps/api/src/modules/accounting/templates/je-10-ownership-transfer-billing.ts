import type { JournalEntryDraft } from './types';
import { arAccountForParty } from './types';

type Input = {
  ownershipHistoryId: string;
  effectiveDate: Date;
  amountPkr: number;
  bookType: 'PACCI' | 'KATCHI';
  fromParty: { id: string; partyType: string; name: string };
  toParty: { id: string; partyType: string; name: string };
  lot: { id: string; lotNumber: string };
};

/**
 * JE-10: Ownership Transfer — Billing Reassignment.
 *
 * When a lot's billing party changes mid-storage, the unbilled accrued storage charges shift
 * from the old party's AR to the new party's AR.
 *
 *   DR  AR (new party)        accrued_amount
 *     CR  AR (old party)        accrued_amount
 *
 * This template handles only the AR shift. The accrued amount itself is computed by the
 * caller from the unbilled storage period.
 */
export function buildJE10OwnershipTransferBilling(input: Input): JournalEntryDraft {
  const fromAr = arAccountForParty(input.fromParty.partyType);
  const toAr = arAccountForParty(input.toParty.partyType);
  const amount = round2(input.amountPkr);

  return {
    entryType: 'ADJUSTMENT',
    bookType: input.bookType,
    sourceTable: 'ownership_history',
    sourceId: input.ownershipHistoryId,
    entryDate: input.effectiveDate,
    description: `Billing reassignment — Lot ${input.lot.lotNumber}: ${input.fromParty.name} → ${input.toParty.name}`,
    lines: [
      {
        accountCode: toAr,
        debitAmount: amount,
        creditAmount: 0,
        partyId: input.toParty.id,
        lotId: input.lot.id,
        description: `Take over AR — ${input.toParty.name}`,
      },
      {
        accountCode: fromAr,
        debitAmount: 0,
        creditAmount: amount,
        partyId: input.fromParty.id,
        lotId: input.lot.id,
        description: `Release AR — ${input.fromParty.name}`,
      },
    ],
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
