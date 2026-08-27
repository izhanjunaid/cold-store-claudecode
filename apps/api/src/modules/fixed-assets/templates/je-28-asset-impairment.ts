import type { JournalEntryDraft } from './types';

export const ACCOUNT_IMPAIRMENT_LOSS = '6160';
export const ACCOUNT_ACCUM_IMPAIRMENT = '1370';

type Input = {
  assetId: string;
  assetNumber: string;
  assetName: string;
  impairmentDate: Date;
  amountPkr: number;
  reason: string;
  bookType: 'PACCI' | 'KATCHI';
};

/**
 * JE-28: Impairment of a fixed asset (IFRS for SMEs Section 27).
 *
 *   DR  6160  Impairment Loss — Fixed Assets   amount
 *     CR  1370  Accum. Impairment — Fixed Assets  amount
 *
 * The credit goes to 1370, NOT to the asset's accumulated-depreciation
 * account and NOT to the asset account itself. Crediting accumulated
 * depreciation would conflate systematic allocation over a useful life with a
 * one-off write-down, and make the standard disclosure (cost, accumulated
 * depreciation, accumulated impairment, carrying amount) impossible to
 * reconstruct. Crediting the asset account would be worse: it destroys
 * original cost.
 *
 * No balance-sheet change is needed for this to present correctly — the
 * statement sums every DETAIL account under the NON_CURRENT_ASSET headers, so
 * a credit-normal 1370 under 1300 reduces carrying amount on its own.
 */
export function buildJE28AssetImpairment(input: Input): JournalEntryDraft {
  const amount = Math.round(input.amountPkr * 100) / 100;
  return {
    entryType: 'ADJUSTMENT',
    bookType: input.bookType,
    sourceTable: 'fixed_assets',
    sourceId: input.assetId,
    entryDate: input.impairmentDate,
    description: `Impairment of ${input.assetName} (${input.assetNumber}) — ${input.reason}`,
    lines: [
      {
        accountCode: ACCOUNT_IMPAIRMENT_LOSS,
        debitAmount: amount,
        creditAmount: 0,
        description: `Impairment loss — ${input.assetNumber}`,
      },
      {
        accountCode: ACCOUNT_ACCUM_IMPAIRMENT,
        debitAmount: 0,
        creditAmount: amount,
        description: `Accumulated impairment — ${input.assetNumber}`,
      },
    ],
  };
}
