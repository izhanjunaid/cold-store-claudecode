import type { JournalEntryDraft } from './types';

type Input = {
  originalEntry: {
    id: string;
    entryNumber: string;
    lines: {
      accountCode: string;
      debitAmount: number;
      creditAmount: number;
      partyId: string | null;
      lotId: string | null;
      description: string | null;
    }[];
  };
  reversalDate: Date;
  bookType: 'PACCI' | 'KATCHI';
};

/**
 * JE-11R: Accrued Revenue Reversal.
 *
 * Reverses every line of the original JE-11 by swapping debit/credit columns. Posts as REVERSAL
 * entry referencing the original (the JE service handles reversed_by linkage).
 */
export function buildJE11RAccrualReversal(input: Input): JournalEntryDraft {
  return {
    entryType: 'REVERSAL',
    bookType: input.bookType,
    sourceTable: 'manual',
    sourceId: input.originalEntry.id,
    entryDate: input.reversalDate,
    description: `Reversal of accrual ${input.originalEntry.entryNumber}`,
    lines: input.originalEntry.lines.map((l) => ({
      accountCode: l.accountCode,
      debitAmount: round2(Number(l.creditAmount)),
      creditAmount: round2(Number(l.debitAmount)),
      partyId: l.partyId,
      lotId: l.lotId,
      description: l.description ? `Reverse: ${l.description}` : null,
    })),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
