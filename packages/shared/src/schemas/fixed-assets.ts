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

export const ReverseDisposalRequest = z.object({
  reason: z.string().min(1).max(400),
  reversal_date: dateOnly.optional(),
});
export type ReverseDisposalRequestType = z.infer<typeof ReverseDisposalRequest>;

export const RunDepreciationRequest = z.object({
  period_year: z.number().int().min(2020).max(2100),
  period_month: z.number().int().min(1).max(12),
});
export type RunDepreciationRequestType = z.infer<typeof RunDepreciationRequest>;

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
      depreciation_amount_pkr: z.number(),
      journal_entry_id: z.string().uuid(),
    }),
  ),
});
export type DepreciationRunResponseType = z.infer<typeof DepreciationRunResponse>;
