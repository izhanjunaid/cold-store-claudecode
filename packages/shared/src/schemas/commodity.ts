import { z } from 'zod';

export const CreateCommodityRequest = z.object({
  name: z.string().min(1).max(100),
  unit_label: z.string().min(1).max(20),
  default_storage_days_alert: z.number().int().positive().optional(),
  /** One unit ("Bag", "Crate"); `unit_label` is the plural shown beside a count. */
  unit_name: z.string().min(1).max(20).optional(),
  unit_name_urdu: z.string().max(40).nullable().optional(),
  /** What one unit usually weighs. Information only: rent is not charged from it. */
  unit_weight_kg: z.number().positive().max(100000).nullable().optional(),
  /** Room one unit takes, in the room's capacity units (1 = the goods room capacity is counted in). */
  space_factor: z.number().positive().max(100).optional(),
  /** The revenue account the storage rent of these goods posts to. */
  revenue_account_code: z.string().regex(/^[0-9]+$/).max(10).optional(),
});

export const UpdateCommodityRequest = CreateCommodityRequest.partial();

export const CreateVarietyRequest = z.object({
  name: z.string().min(1).max(100),
});

export const CommodityResponse = z.object({
  id: z.string().uuid(),
  name: z.string(),
  unit_label: z.string(),
  default_storage_days_alert: z.number().nullable(),
  unit_name: z.string(),
  unit_name_urdu: z.string().nullable(),
  unit_weight_kg: z.number().nullable(),
  space_factor: z.number(),
  revenue_account_code: z.string().nullable(),
  is_active: z.boolean(),
  varieties: z.array(z.object({
    id: z.string().uuid(),
    name: z.string(),
    is_active: z.boolean(),
  })).optional(),
});

export const VarietyResponse = z.object({
  id: z.string().uuid(),
  commodity_id: z.string().uuid(),
  name: z.string(),
  is_active: z.boolean(),
});

export type CommodityResponseType = z.infer<typeof CommodityResponse>;
