import { SYSTEM_ACCOUNTS, round2 } from '@coldchain/shared';
import type { JournalEntryDraft } from './types';

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
 * A credit-normal 1370 under the 1300 header reduces carrying amount on the
 * balance sheet with no statement-side change.
 */
export function buildJE28AssetImpairment(input: Input): JournalEntryDraft {
  const amount = round2(input.amountPkr);
  return {
    entryType: 'IMPAIRMENT',
    bookType: input.bookType,
    sourceTable: 'fixed_assets',
    sourceId: input.assetId,
    entryDate: input.impairmentDate,
    description: `Impairment of ${input.assetName} (${input.assetNumber}) — ${input.reason}`,
    lines: [
      {
        accountCode: SYSTEM_ACCOUNTS.IMPAIRMENT_LOSS,
        debitAmount: amount,
        creditAmount: 0,
        description: `Impairment loss — ${input.assetNumber}`,
      },
      {
        accountCode: SYSTEM_ACCOUNTS.FA_ACC_IMPAIRMENT,
        debitAmount: 0,
        creditAmount: amount,
        description: `Accumulated impairment — ${input.assetNumber}`,
      },
    ],
  };
}
