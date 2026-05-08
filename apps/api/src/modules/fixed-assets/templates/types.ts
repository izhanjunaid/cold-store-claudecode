import type { JournalEntryDraft, JournalEntryLineDraft } from '../../accounting/templates/types';

export type { JournalEntryDraft, JournalEntryLineDraft };

/**
 * Default account codes per asset category. The asset record stores its own copies,
 * but the create-asset endpoint resolves codes from this map so callers do not have
 * to supply them manually.
 *
 * Cold plant depreciation hits 5040 (direct cost; reduces gross profit).
 * Building / vehicle / computer / software depreciation hits 6XXX (indirect; net profit only).
 */
export const ASSET_CATEGORY_ACCOUNT_DEFAULTS: Record<
  'COLD_PLANT' | 'BUILDING' | 'VEHICLE' | 'COMPUTER' | 'OTHER',
  { asset: string; accumDepr: string; deprExpense: string }
> = {
  COLD_PLANT: { asset: '1310', accumDepr: '1311', deprExpense: '5040' },
  BUILDING: { asset: '1320', accumDepr: '1321', deprExpense: '6120' },
  VEHICLE: { asset: '1330', accumDepr: '1331', deprExpense: '6130' },
  COMPUTER: { asset: '1340', accumDepr: '1341', deprExpense: '6140' },
  OTHER: { asset: '1310', accumDepr: '1311', deprExpense: '6100' },
};

export const ACCOUNT_GAIN_ON_DISPOSAL = '4230';
export const ACCOUNT_LOSS_ON_DISPOSAL = '6110';

export function defaultsForCategory(category: keyof typeof ASSET_CATEGORY_ACCOUNT_DEFAULTS) {
  return ASSET_CATEGORY_ACCOUNT_DEFAULTS[category];
}
