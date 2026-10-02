import type { ReceivableParty } from '../../party/receivable-party';
import type { JournalEntryDraft } from './types';
import { SYSTEM_ACCOUNTS, round2 } from '@coldchain/shared';

type Input = {
  paymentId: string;
  /** What the advance was applied to, for the narration ("invoice INV-…"). */
  appliedTo: string;
  appliedDate: Date;
  amountPkr: number;
  bookType: 'PACCI' | 'KATCHI';
  party: ReceivableParty;
};

/**
 * JE-04: Advance Applied to Invoice.
 *
 *   DR  2010 Advance Receipts from Clients   applied_amount
 *     CR  party control account (AR)          applied_amount
 *
 * Posted on every application of an advance, dated the day it is applied, and
 * sourced to the payment so a dishonour reverses it with the rest of the chain.
 */
export function buildJE04AdvanceApplied(input: Input): JournalEntryDraft {
  const amount = round2(input.amountPkr);
  return {
    entryType: 'ADVANCE_APPLIED',
    bookType: input.bookType,
    sourceTable: 'payments',
    sourceId: input.paymentId,
    entryDate: input.appliedDate,
    description: `Advance applied to ${input.appliedTo} — ${input.party.name}`,
    lines: [
      {
        accountCode: SYSTEM_ACCOUNTS.CUSTOMER_ADVANCES,
        debitAmount: amount,
        creditAmount: 0,
        partyId: input.party.id,
        description: `Apply advance to ${input.appliedTo}`,
      },
      {
        accountCode: input.party.controlAccountCode,
        debitAmount: 0,
        creditAmount: amount,
        partyId: input.party.id,
        description: `Settle AR — ${input.party.name} via advance`,
      },
    ],
  };
}
