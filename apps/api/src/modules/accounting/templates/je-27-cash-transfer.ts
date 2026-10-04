import type { JournalEntryDraft } from './types';

type Input = {
  transferId: string;
  transferDate: Date;
  amountPkr: number;
  from: { code: string; name: string };
  to: { code: string; name: string };
  bookType: 'PACCI' | 'KATCHI';
  note?: string | null;
};

/**
 * JE-27: Transfer between two of the facility's own cash equivalents.
 *
 *   DR  destination   amount
 *     CR  source        amount
 *
 * Both accounts are validated against the chart's `is_cash_equivalent` flag by the
 * service, so an owner's second bank account works and cheques in hand never do.
 * The entry is sourced to its `cash_transfers` row (docs/25 C-44) — the document is
 * what lists it and what voids it.
 *
 * The cash flow statement excludes these: money moving between your own pockets is
 * not a flow.
 */
export function buildJE27CashTransfer(input: Input): JournalEntryDraft {
  const amount = Math.round(input.amountPkr * 100) / 100;
  const note = input.note?.trim();

  return {
    entryType: 'CASH_TRANSFER',
    bookType: input.bookType,
    sourceTable: 'cash_transfers',
    sourceId: input.transferId,
    entryDate: input.transferDate,
    description: `Transfer ${input.from.name} → ${input.to.name}${note ? ` — ${note}` : ''}`,
    lines: [
      {
        accountCode: input.to.code,
        debitAmount: amount,
        creditAmount: 0,
        description: note ?? `Transfer in from ${input.from.name}`,
      },
      {
        accountCode: input.from.code,
        debitAmount: 0,
        creditAmount: amount,
        description: note ?? `Transfer out to ${input.to.name}`,
      },
    ],
  };
}
