import { z } from 'zod';

export const CreateCommodityRequest = z.object({
  name: z.string().min(1).max(100),
  unit_label: z.string().min(1).max(20),
  default_storage_days_alert: z.number().int().positive().optional(),
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
