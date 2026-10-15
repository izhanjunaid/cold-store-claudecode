import { z } from 'zod';
import { QueryBoolean } from './common';
import { ServiceUnitType } from './enums';

export const CreateServiceChargeRequest = z.object({
  name: z.string().min(1).max(100),
  unit_type: ServiceUnitType,
  unit_price_pkr: z.number().nonnegative(),
  /** Pre-added to the bill when a withdrawal is dispatched. */
  apply_at_dispatch: z.boolean().optional(),
});

export const UpdateServiceChargeRequest = z.object({
  name: z.string().min(1).max(100).optional(),
  unit_type: ServiceUnitType.optional(),
  unit_price_pkr: z.number().nonnegative().optional(),
  is_active: z.boolean().optional(),
  apply_at_dispatch: z.boolean().optional(),
});

export const ServiceChargeListQuery = z.object({
  is_active: QueryBoolean.optional(),
});

export const ServiceChargeResponse = z.object({
  id: z.string().uuid(),
  facility_id: z.string().uuid(),
  name: z.string(),
  unit_type: ServiceUnitType,
  unit_price_pkr: z.number(),
  is_active: z.boolean(),
  apply_at_dispatch: z.boolean(),
  created_at: z.string(),
});
