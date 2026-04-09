import { z } from 'zod';
import { TemperatureSource } from './enums';
import { PaginationQuery } from './common';

export const CreateChamberRequest = z.object({
  name: z.string().min(1).max(100),
  commodity_restriction_id: z.string().uuid().nullable().optional(),
  max_capacity_bags: z.number().int().positive(),
  temperature_min_c: z.number().min(-50).max(50).optional(),
  temperature_max_c: z.number().min(-50).max(50).optional(),
  notes: z.string().optional(),
});

export const UpdateChamberRequest = CreateChamberRequest.partial();

export const ChamberListQuery = PaginationQuery.extend({
  is_active: z.coerce.boolean().optional(),
});

export const LogTemperatureRequest = z.object({
  temperature_c: z.number().min(-30).max(50),
  recorded_at: z.string().datetime().optional(),
  source: TemperatureSource.default('MANUAL'),
});

export const ChamberResponse = z.object({
  id: z.string().uuid(),
  facility_id: z.string().uuid(),
  name: z.string(),
  commodity_restriction_id: z.string().uuid().nullable(),
  commodity_restriction_name: z.string().nullable().optional(),
  max_capacity_bags: z.number(),
  current_occupancy_bags: z.number(),
  available_capacity_bags: z.number(),
  temperature_min_c: z.number().nullable(),
  temperature_max_c: z.number().nullable(),
  is_active: z.boolean(),
  notes: z.string().nullable(),
  last_temperature: z.object({
    temperature_c: z.number(),
    recorded_at: z.string(),
    source: TemperatureSource,
  }).nullable().optional(),
});

export const TemperatureLogResponse = z.object({
  id: z.string().uuid(),
  chamber_id: z.string().uuid(),
  temperature_c: z.number(),
  recorded_at: z.string(),
  recorded_by: z.string().uuid(),
  recorded_by_name: z.string().optional(),
  source: TemperatureSource,
});
