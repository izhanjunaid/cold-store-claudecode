import type { JournalEntryDraft, JournalEntryLineDraft } from './types';
import { ACCOUNT_ADVANCE_RECEIPTS, arAccountForParty, assetAccountForPaymentMethod } from './types';

type Input = {
  paymentId: string;
  dishonourDate: Date;
  amountPkr: number;
  bookType: 'PACCI' | 'KATCHI';
  party: { id: string; partyType: string; name: string };
  originalAssetAccountCode?: string | null;
  /**
   * Portion of the bounced payment still sitting in 2010 Advance Receipts — i.e. received
   * as an advance (JE-03) and not yet applied to an invoice (JE-04). Omit/0 for an ordinary
   * receipt, which reverses wholly against AR exactly as before.
   */
  advanceRemainderPkr?: number;
};

/**
 * JE-06: Cheque Dishonoured (Bounce).
 *
 *   DR  2010 Advance Receipts                advance_remainder   (only if > 0)
 *   DR  1110/1120/1130 Receivable — Type     amount − remainder  (only if > 0)
 *     CR  1020 Bank Account — Main              amount_pkr
 *
 * Reverses the bank debit and re-opens whatever the original receipt credited.
 *
 * The split matters. An ordinary receipt posts JE-02 (DR bank / CR AR), so its reversal is
 * wholly against AR. An *advance* posts JE-03 (DR bank / CR 2010) and only moves to AR when
 * it is applied via JE-04 (DR 2010 / CR AR). Reversing an unapplied advance against AR would
 * leave the advance liability standing AND invent a receivable — a misstatement of twice the
 * cheque, on both sides of the balance sheet, that still "balances". So the debit follows the
 * money: 2010 for whatever is still unapplied, AR for whatever JE-04 already moved.
 *
 * Posts as a REVERSAL entry referencing the original (the JE service handles reversed_by).
 */
export function buildJE06ChequeDishonoured(input: Input): JournalEntryDraft {
  const arAccount = arAccountForParty(input.party.partyType);
  const bankAccount = input.originalAssetAccountCode ?? assetAccountForPaymentMethod('CHEQUE');
  const amount = round2(input.amountPkr);

  // Clamp defensively: the remainder can never exceed what is being reversed.
  const advanceRemainder = Math.min(round2(input.advanceRemainderPkr ?? 0), amount);
  const arPortion = round2(amount - advanceRemainder);

  const lines: JournalEntryLineDraft[] = [];

  if (advanceRemainder > 0) {
    lines.push({
      accountCode: ACCOUNT_ADVANCE_RECEIPTS,
      debitAmount: advanceRemainder,
      creditAmount: 0,
      partyId: input.party.id,
      description: `Reverse unapplied advance after cheque bounce — ${input.party.name}`,
    });
  }

  if (arPortion > 0) {
    lines.push({
      accountCode: arAccount,
      debitAmount: arPortion,
      creditAmount: 0,
      partyId: input.party.id,
      description: `Re-open AR after cheque bounce — ${input.party.name}`,
    });
  }

  lines.push({
    accountCode: bankAccount,
    debitAmount: 0,
    creditAmount: amount,
    partyId: input.party.id,
    description: `Reverse bank entry — bounced cheque`,
  });

  return {
    entryType: 'REVERSAL',
    bookType: input.bookType,
    sourceTable: 'payments',
    sourceId: input.paymentId,
    entryDate: input.dishonourDate,
    description: `Cheque dishonoured — ${input.party.name} (PKR ${amount})`,
    lines,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
