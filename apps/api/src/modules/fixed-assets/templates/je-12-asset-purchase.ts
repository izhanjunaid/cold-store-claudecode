import type { JournalEntryDraft } from './types';

type Input = {
  assetId: string;
  assetNumber: string;
  assetName: string;
  assetAccountCode: string;
  paidFromAccountCode: string;
  costPkr: number;
  purchaseDate: Date;
  bookType: 'PACCI' | 'KATCHI';
};

/**
 * JE-12: Fixed Asset Purchased.
 *
 *   DR  1310/1320/1330/1340  Fixed Asset — [Category]   purchase_cost
 *     CR  1010/1020              Cash / Bank               purchase_cost
 */
export function buildJE12AssetPurchase(input: Input): JournalEntryDraft {
  const amount = round2(input.costPkr);
  return {
    entryType: 'ASSET_PURCHASE',
    bookType: input.bookType,
    sourceTable: 'fixed_assets',
    sourceId: input.assetId,
    entryDate: input.purchaseDate,
    description: `Asset purchase ${input.assetNumber} — ${input.assetName}`,
    lines: [
      {
        accountCode: input.assetAccountCode,
        debitAmount: amount,
        creditAmount: 0,
        description: `Acquire ${input.assetName} (${input.assetNumber})`,
      },
      {
        accountCode: input.paidFromAccountCode,
        debitAmount: 0,
        creditAmount: amount,
        description: `Payment for asset ${input.assetNumber}`,
      },
    ],
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
