import { SYSTEM_ACCOUNTS } from '@coldchain/shared';
import type { JournalEntryDraft } from './types';

type Input = {
  handoverId: string;
  handoverNumber: string;
  entryDate: Date;
  /** counted − expected: negative = short (cash missing), positive = over. Never 0. */
  variancePkr: number;
  collectorName: string;
};

/**
 * JE-28: the difference found when a manager counts a collector's cash.
 *
 *   short:  DR  Cash Short & Over   |variance|        over:  DR  Cash on Hand   variance
 *             CR  Cash on Hand        |variance|                 CR  Cash Short & Over   variance
 *
 * Every CASH receipt already debited Cash on Hand when it was recorded, so a count equal to the
 * receipts needs no entry at all (custody moved, not money). Only a difference posts, so the ledger
 * matches the drawer. Sourced to its `cash_handovers` row, PACCI only: the handover is the
 * official count, and KATCHI receipts are not tracked.
 */
export function buildJE28CashVariance(input: Input): JournalEntryDraft {
  const amount = Math.round(Math.abs(input.variancePkr) * 100) / 100;
  const short = input.variancePkr < 0;
  const why = short ? 'short' : 'over';
  return {
    entryType: 'CASH_VARIANCE',
    bookType: 'PACCI',
    sourceTable: 'cash_handovers',
    sourceId: input.handoverId,
    entryDate: input.entryDate,
    description: `Cash ${why} ${amount.toFixed(2)} — handover ${input.handoverNumber} from ${input.collectorName}`,
    lines: [
      {
        accountCode: short ? SYSTEM_ACCOUNTS.CASH_SHORT_OVER : SYSTEM_ACCOUNTS.CASH_ON_HAND,
        debitAmount: amount,
        creditAmount: 0,
        description: `Cash ${why}, handover ${input.handoverNumber}`,
      },
      {
        accountCode: short ? SYSTEM_ACCOUNTS.CASH_ON_HAND : SYSTEM_ACCOUNTS.CASH_SHORT_OVER,
        debitAmount: 0,
        creditAmount: amount,
        description: `Cash ${why}, handover ${input.handoverNumber}`,
      },
    ],
  };
}
