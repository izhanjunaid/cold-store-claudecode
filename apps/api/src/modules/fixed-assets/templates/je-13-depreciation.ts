import type { JournalEntryDraft } from './types';

type Input = {
  assetId: string;
  assetNumber: string;
  assetName: string;
  deprExpenseAccountCode: string;
  accumDeprAccountCode: string;
  periodYear: number;
  periodMonth: number;
  amountPkr: number;
  bookType: 'PACCI' | 'KATCHI';
};

/**
 * JE-13: Monthly Depreciation Charge.
 *
 *   DR  5040 (cold plant) | 6120 (building) | 6130 (vehicle) | 6140 (computer)
 *     CR  1311 / 1321 / 1331 / 1341  Accumulated Depreciation
 *
 * The depreciation expense account is sourced from `asset.deprExpenseAccountCode`,
 * which is set per-asset from ASSET_CATEGORY_ACCOUNT_DEFAULTS at creation time.
 */
export function buildJE13Depreciation(input: Input): JournalEntryDraft {
  const amount = round2(input.amountPkr);
  // Post on the last day of the period for financial-statement accuracy.
  const entryDate = new Date(Date.UTC(input.periodYear, input.periodMonth, 0));
  const periodLabel = `${input.periodYear}-${String(input.periodMonth).padStart(2, '0')}`;
  return {
    entryType: 'DEPRECIATION',
    bookType: input.bookType,
    sourceTable: 'fixed_assets',
    sourceId: input.assetId,
    entryDate,
    description: `Depreciation ${periodLabel} — ${input.assetName} (${input.assetNumber})`,
    lines: [
      {
        accountCode: input.deprExpenseAccountCode,
        debitAmount: amount,
        creditAmount: 0,
        description: `Depreciation ${periodLabel} — ${input.assetNumber}`,
      },
      {
        accountCode: input.accumDeprAccountCode,
        debitAmount: 0,
        creditAmount: amount,
        description: `Accumulated depreciation ${periodLabel} — ${input.assetNumber}`,
      },
    ],
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
