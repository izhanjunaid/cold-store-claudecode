import type { JournalEntryDraft, JournalEntryLineDraft } from './types';
import { ACCOUNT_GAIN_ON_DISPOSAL, ACCOUNT_LOSS_ON_DISPOSAL } from './types';
import { ACCOUNT_ACCUM_IMPAIRMENT } from './je-28-asset-impairment';

type Input = {
  assetId: string;
  assetNumber: string;
  assetName: string;
  assetAccountCode: string;
  accumDeprAccountCode: string;
  proceedsAccountCode: string;
  disposalDate: Date;
  costPkr: number;
  accumDeprPkr: number;
  /** Cumulative impairment written down against this asset. Zero for almost every asset. */
  accumImpairmentPkr?: number;
  proceedsPkr: number;
  bookType: 'PACCI' | 'KATCHI';
};

/**
 * JE-14: Asset Disposed (Sold or Scrapped).
 *
 * Three sub-cases based on proceeds vs. Net Book Value (NBV = cost − accum_depr):
 *
 * Case A — proceeds == NBV (no gain/loss):
 *   DR  1020 (proceeds)        proceeds
 *   DR  1311 (accum depr)      accum_depr
 *     CR  1310 (asset cost)      cost
 *
 * Case B — proceeds > NBV (GAIN):
 *   DR  1020                  proceeds
 *   DR  1311                  accum_depr
 *     CR  1310                  cost
 *     CR  4230 Gain             gain (= proceeds − NBV)
 *
 * Case C — proceeds < NBV (LOSS) or scrapped:
 *   DR  1020                  proceeds (may be 0)
 *   DR  1311                  accum_depr
 *   DR  6110 Loss             loss (= NBV − proceeds)
 *     CR  1310                  cost
 *
 * An impaired asset additionally carries a credit balance in 1370, which has
 * to be cleared here too:
 *   DR  1370 Accum. Impairment  accum_impairment
 * and NBV is cost − accum_depr − accum_impairment. Leaving 1370 out would
 * strand the write-down against an asset that no longer exists and would book
 * the impairment a second time as a disposal loss.
 */
export function buildJE14AssetDisposal(input: Input): JournalEntryDraft {
  const cost = round2(input.costPkr);
  const accumDepr = round2(input.accumDeprPkr);
  const accumImpairment = round2(input.accumImpairmentPkr ?? 0);
  const proceeds = round2(input.proceedsPkr);
  const nbv = round2(cost - accumDepr - accumImpairment);
  const gainOrLoss = round2(proceeds - nbv);

  const lines: JournalEntryLineDraft[] = [];

  if (proceeds > 0) {
    lines.push({
      accountCode: input.proceedsAccountCode,
      debitAmount: proceeds,
      creditAmount: 0,
      description: `Proceeds from disposal of ${input.assetNumber}`,
    });
  }

  if (accumDepr > 0) {
    lines.push({
      accountCode: input.accumDeprAccountCode,
      debitAmount: accumDepr,
      creditAmount: 0,
      description: `Clear accumulated depreciation — ${input.assetNumber}`,
    });
  }

  if (accumImpairment > 0) {
    lines.push({
      accountCode: ACCOUNT_ACCUM_IMPAIRMENT,
      debitAmount: accumImpairment,
      creditAmount: 0,
      description: `Clear accumulated impairment — ${input.assetNumber}`,
    });
  }

  if (gainOrLoss < -0.005) {
    // Loss
    lines.push({
      accountCode: ACCOUNT_LOSS_ON_DISPOSAL,
      debitAmount: round2(-gainOrLoss),
      creditAmount: 0,
      description: `Loss on disposal of ${input.assetNumber}`,
    });
  }

  lines.push({
    accountCode: input.assetAccountCode,
    debitAmount: 0,
    creditAmount: cost,
    description: `Remove asset cost ${input.assetNumber}`,
  });

  if (gainOrLoss > 0.005) {
    lines.push({
      accountCode: ACCOUNT_GAIN_ON_DISPOSAL,
      debitAmount: 0,
      creditAmount: round2(gainOrLoss),
      description: `Gain on disposal of ${input.assetNumber}`,
    });
  }

  return {
    entryType: 'ASSET_DISPOSAL',
    bookType: input.bookType,
    sourceTable: 'fixed_assets',
    sourceId: input.assetId,
    entryDate: input.disposalDate,
    description: `Disposal of ${input.assetName} (${input.assetNumber}) — proceeds Rs. ${proceeds.toLocaleString()}`,
    lines,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
