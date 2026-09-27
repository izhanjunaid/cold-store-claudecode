import { z } from 'zod';
import { BookType } from './enums';

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

export const AssetCategory = z.enum(['COLD_PLANT', 'BUILDING', 'VEHICLE', 'COMPUTER', 'OTHER']);
export const DepreciationMethod = z.enum(['SLM', 'WDV']);
export const FixedAssetStatus = z.enum([
  'PLANNED',
  'PURCHASED',
  'IN_SERVICE',
  'DISPOSED',
  'WRITTEN_OFF',
]);

export const CreateFixedAssetRequest = z
  .object({
    asset_name: z.string().min(1).max(200),
    asset_category: AssetCategory,
    purchase_date: dateOnly,
    purchase_cost_pkr: z.number().positive(),
    residual_value_pkr: z.number().nonnegative().optional(),
    useful_life_years: z.number().positive().optional(),
    depreciation_method: DepreciationMethod,
    wdv_rate_percent: z.number().positive().max(100).optional(),
    paid_from_account_code: z.string().regex(/^[0-9]+$/).optional(),
    asset_account_code: z.string().regex(/^[0-9]+$/).optional(),
    accum_depr_account_code: z.string().regex(/^[0-9]+$/).optional(),
    depr_expense_account_code: z.string().regex(/^[0-9]+$/).optional(),
    book_type: BookType.optional(),
    notes: z.string().optional(),
  })
  .refine(
    (b) => (b.depreciation_method === 'SLM' ? !!b.useful_life_years : true),
    { message: 'useful_life_years required for SLM', path: ['useful_life_years'] },
  )
  .refine(
    (b) => (b.depreciation_method === 'WDV' ? !!b.wdv_rate_percent : true),
    { message: 'wdv_rate_percent required for WDV', path: ['wdv_rate_percent'] },
  );
export type CreateFixedAssetRequestType = z.infer<typeof CreateFixedAssetRequest>;

/**
 * An asset the business already owned at go-live (docs/25 C-30). Its cost and the
 * depreciation charged on it so far are already in the opening-balance entry, so it
 * joins the register with no journal entry of its own; depreciation resumes with the
 * first month that ends after the opening date.
 */
export const OpeningAsset = z
  .object({
    asset_name: z.string().min(1).max(200),
    asset_category: AssetCategory,
    purchase_date: dateOnly,
    purchase_cost_pkr: z.number().positive(),
    accumulated_depreciation_pkr: z.number().nonnegative(),
    residual_value_pkr: z.number().nonnegative().optional(),
    useful_life_years: z.number().positive().optional(),
    depreciation_method: DepreciationMethod,
    wdv_rate_percent: z.number().positive().max(100).optional(),
    /** When it went into service; omit for an asset not yet in use at go-live. */
    depreciation_start_date: dateOnly.optional(),
    asset_account_code: z.string().regex(/^[0-9]+$/).optional(),
    accum_depr_account_code: z.string().regex(/^[0-9]+$/).optional(),
    depr_expense_account_code: z.string().regex(/^[0-9]+$/).optional(),
    notes: z.string().optional(),
  })
  .refine((b) => (b.depreciation_method === 'SLM' ? !!b.useful_life_years : true), {
    message: 'useful_life_years required for SLM',
    path: ['useful_life_years'],
  })
  .refine((b) => (b.depreciation_method === 'WDV' ? !!b.wdv_rate_percent : true), {
    message: 'wdv_rate_percent required for WDV',
    path: ['wdv_rate_percent'],
  })
  .refine((b) => b.accumulated_depreciation_pkr <= b.purchase_cost_pkr - (b.residual_value_pkr ?? 0), {
    message: 'Accumulated depreciation cannot exceed cost less residual value',
    path: ['accumulated_depreciation_pkr'],
  })
  .refine((b) => b.accumulated_depreciation_pkr === 0 || !!b.depreciation_start_date, {
    message: 'An asset with depreciation charged was in service; give the date it went into service',
    path: ['depreciation_start_date'],
  });
export type OpeningAssetType = z.infer<typeof OpeningAsset>;

export const ImportOpeningAssetsRequest = z.object({ assets: z.array(OpeningAsset).min(1).max(200) });
export type ImportOpeningAssetsRequestType = z.infer<typeof ImportOpeningAssetsRequest>;

/**
 * An asset entered through the register AND in the opening-balance entry has its
 * cost twice (pre-update check C08). This reverses its purchase entry and keeps the
 * register row as an opening asset, adding the depreciation the opening entry
 * already carries for it.
 */
export const ConvertToOpeningAssetRequest = z.object({
  reason: z.string().min(1).max(400),
  opening_accumulated_depreciation_pkr: z.number().nonnegative().default(0),
  reversal_date: dateOnly.optional(),
});
export type ConvertToOpeningAssetRequestType = z.infer<typeof ConvertToOpeningAssetRequest>;

/** Register against ledger at go-live, per fixed-asset account (cost or accumulated depreciation). */
export const OpeningAssetTieOutResponse = z.object({
  opening_date: z.string().nullable(),
  accounts: z.array(
    z.object({
      account_code: z.string(),
      account_name: z.string(),
      kind: z.enum(['COST', 'ACCUMULATED_DEPRECIATION']),
      ledger_pkr: z.number(),
      register_pkr: z.number(),
      difference_pkr: z.number(),
    }),
  ),
  is_reconciled: z.boolean(),
});
export type OpeningAssetTieOutResponseType = z.infer<typeof OpeningAssetTieOutResponse>;

export const CommissionAssetRequest = z.object({
  depreciation_start_date: dateOnly,
});
export type CommissionAssetRequestType = z.infer<typeof CommissionAssetRequest>;

export const DisposeAssetRequest = z.object({
  disposal_date: dateOnly,
  disposal_proceeds_pkr: z.number().nonnegative(),
  proceeds_account_code: z.string().regex(/^[0-9]+$/).optional(),
});
export type DisposeAssetRequestType = z.infer<typeof DisposeAssetRequest>;

// IFRS for SMEs Section 27 write-down. The reason is required, not optional:
// an impairment is a judgement, and a judgement with no stated basis is not
// auditable.
export const ImpairAssetRequest = z.object({
  impairment_date: dateOnly,
  amount_pkr: z.number().positive(),
  reason: z.string().min(1).max(300),
});
export type ImpairAssetRequestType = z.infer<typeof ImpairAssetRequest>;

export const ReverseDisposalRequest = z.object({
  reason: z.string().min(1).max(400),
  reversal_date: dateOnly.optional(),
});
export type ReverseDisposalRequestType = z.infer<typeof ReverseDisposalRequest>;

/**
 * Correct the latest depreciation month or the latest impairment (docs/25 C-33). The
 * reversal defaults to the original entry's own date, so the correction lands in the
 * month it corrects.
 */
export const ReverseAssetEntryRequest = z.object({
  reason: z.string().min(1).max(400),
  reversal_date: dateOnly.optional(),
});
export type ReverseAssetEntryRequestType = z.infer<typeof ReverseAssetEntryRequest>;

/** Void an asset entered in error: reverses its purchase entry; only before anything else posted to it. */
export const VoidAssetRequest = z.object({
  reason: z.string().min(1).max(400),
  void_date: dateOnly.optional(),
});
export type VoidAssetRequestType = z.infer<typeof VoidAssetRequest>;

/**
 * Post every unposted month of depreciation up to this period, asset by asset
 * (docs/25 C-29). One book per run: a KATCHI run is the owner's.
 */
export const RunDepreciationRequest = z.object({
  period_year: z.number().int().min(2020).max(2100),
  period_month: z.number().int().min(1).max(12),
  book_type: BookType.optional(),
});
export type RunDepreciationRequestType = z.infer<typeof RunDepreciationRequest>;

/** What the server will let an asset do next, by its state alone (the web adds permissions). */
export const FixedAssetAction = z.enum([
  'commission',
  'impair',
  'dispose',
  'reverse_disposal',
  'reverse_depreciation',
  'reverse_impairment',
  'void',
  'convert_to_opening',
]);
export type FixedAssetActionType = z.infer<typeof FixedAssetAction>;

export const FixedAssetListQuery = z.object({
  status: FixedAssetStatus.optional(),
  category: AssetCategory.optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});
export type FixedAssetListQueryType = z.infer<typeof FixedAssetListQuery>;

export const FixedAssetResponse = z.object({
  id: z.string().uuid(),
  asset_number: z.string(),
  asset_name: z.string(),
  asset_category: AssetCategory,
  purchase_date: z.string(),
  purchase_cost_pkr: z.number(),
  residual_value_pkr: z.number(),
  useful_life_years: z.number().nullable(),
  wdv_rate_percent: z.number().nullable(),
  depreciation_method: DepreciationMethod,
  depreciation_start_date: z.string().nullable(),
  status: FixedAssetStatus,
  accumulated_depreciation_pkr: z.number(),
  net_book_value_pkr: z.number(),
  asset_account_code: z.string(),
  accum_depr_account_code: z.string(),
  depr_expense_account_code: z.string(),
  disposal_date: z.string().nullable(),
  disposal_proceeds_pkr: z.number().nullable(),
  purchase_journal_entry_id: z.string().uuid().nullable(),
  disposal_journal_entry_id: z.string().uuid().nullable(),
  is_opening_balance: z.boolean(),
  voided_at: z.string().nullable(),
  void_reason: z.string().nullable(),
  allowed_actions: z.array(FixedAssetAction),
  book_type: BookType,
  notes: z.string().nullable(),
  created_at: z.string(),
  created_by_name: z.string().optional(),
});
export type FixedAssetResponseType = z.infer<typeof FixedAssetResponse>;

export const DepreciationRunResponse = z.object({
  period_year: z.number().int(),
  period_month: z.number().int(),
  run_count: z.number().int(),
  total_depreciation_pkr: z.number(),
  entries: z.array(
    z.object({
      asset_id: z.string().uuid(),
      asset_number: z.string(),
      period_year: z.number().int(),
      period_month: z.number().int(),
      depreciation_amount_pkr: z.number(),
      journal_entry_id: z.string().uuid(),
    }),
  ),
});
export type DepreciationRunResponseType = z.infer<typeof DepreciationRunResponse>;
