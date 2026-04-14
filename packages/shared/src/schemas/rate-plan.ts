import { z } from 'zod';
import { RateType } from './enums';

export const CreateRatePlanRequest = z
  .object({
    name: z.string().min(1).max(200),
    commodity_id: z.string().uuid().optional().nullable(),
    rate_type: RateType,
    rate_amount_pkr: z.number().positive(),
    season_start_date: z.string().date().optional(),
    season_end_date: z.string().date().optional(),
    min_billing_days: z.number().int().min(1).default(1),
  })
  .refine(
    (v) =>
      v.rate_type !== 'SEASONAL_PER_BAG' ||
      (!!v.season_start_date && !!v.season_end_date),
    {
      message: 'season_start_date and season_end_date are required for SEASONAL_PER_BAG',
      path: ['season_start_date'],
    },
  )
  .refine(
    (v) =>
      v.rate_type !== 'SEASONAL_PER_BAG' ||
      !v.season_start_date ||
      !v.season_end_date ||
      v.season_start_date < v.season_end_date,
    {
      message: 'season_start_date must be before season_end_date',
      path: ['season_end_date'],
    },
  );

export const UpdateRatePlanRequest = z.object({
  name: z.string().min(1).max(200).optional(),
  commodity_id: z.string().uuid().optional().nullable(),
  rate_amount_pkr: z.number().positive().optional(),
  season_start_date: z.string().date().optional().nullable(),
  season_end_date: z.string().date().optional().nullable(),
  min_billing_days: z.number().int().min(1).optional(),
  is_active: z.boolean().optional(),
});

export const RatePlanListQuery = z.object({
  is_active: z.coerce.boolean().optional(),
  commodity_id: z.string().uuid().optional(),
});

export const RatePlanResponse = z.object({
  id: z.string().uuid(),
  facility_id: z.string().uuid(),
  name: z.string(),
  commodity_id: z.string().uuid().nullable(),
  commodity_name: z.string().nullable(),
  rate_type: RateType,
  rate_amount_pkr: z.number(),
  season_start_date: z.string().nullable(),
  season_end_date: z.string().nullable(),
  min_billing_days: z.number(),
  is_active: z.boolean(),
  created_at: z.string(),
});
