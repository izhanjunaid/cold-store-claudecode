import type { JournalEntryDraft } from './types';

/** Cash and cash equivalents. A transfer may only move money between these. */
export const CASH_TRANSFER_ACCOUNTS = ['1010', '1020', '1030'] as const;

type Input = {
  transferDate: Date;
  amountPkr: number;
  fromAccountCode: string;
  toAccountCode: string;
  bookType: 'PACCI' | 'KATCHI';
  /** A transfer has no source document, so the acting user stands in. */
  userId: string;
  note?: string | null;
};

/**
 * JE-27: Transfer between the facility's own cash and bank accounts.
 *
 *   DR  destination (1010/1020/1030)   amount
 *     CR  source      (1010/1020/1030)   amount
 *
 * Depositing the day's cash takings into the bank is a daily operation in a
 * mandi cold store and had no first-class path (backlog P1-10): 1010 grew
 * forever and 1020 never showed a deposit. Only the reverse direction existed,
 * as JE-17C petty-cash replenishment inside the expenses module — which stays
 * where it is, since it carries its own semantics and its own tests. This is
 * the general operation and the only one with a screen, so there is one place
 * to record a transfer rather than two that overlap.
 *
 * The cash flow statement deliberately excludes these: money moving between
 * your own pockets is not a flow. That exclusion only works if the transfer is
 * recordable in the first place.
 */
export function buildJE27CashTransfer(input: Input): JournalEntryDraft {
  const amount = Math.round(input.amountPkr * 100) / 100;
  const note = input.note?.trim();

  return {
    entryType: 'ADJUSTMENT',
    bookType: input.bookType,
    sourceTable: 'cash_transfer',
    sourceId: input.userId,
    entryDate: input.transferDate,
    description: `Transfer ${input.fromAccountCode} → ${input.toAccountCode} Rs. ${amount.toLocaleString()}${note ? ` — ${note}` : ''}`,
    lines: [
      {
        accountCode: input.toAccountCode,
        debitAmount: amount,
        creditAmount: 0,
        description: note ?? `Transfer in from ${input.fromAccountCode}`,
      },
      {
        accountCode: input.fromAccountCode,
        debitAmount: 0,
        creditAmount: amount,
        description: note ?? `Transfer out to ${input.toAccountCode}`,
      },
    ],
  };
}
