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

// ── Racks (a "Room" in the UI is a chamber; racks are its sub-locations) ──

export const CreateRackRequest = z.object({
  name: z.string().min(1).max(50),
  max_capacity_bags: z.number().int().positive(),
  position: z.number().int().min(0).optional(),
  notes: z.string().optional(),
});

export const UpdateRackRequest = CreateRackRequest.partial().extend({
  is_active: z.boolean().optional(),
});

export const RackResponse = z.object({
  id: z.string().uuid(),
  chamber_id: z.string().uuid(),
  name: z.string(),
  max_capacity_bags: z.number(),
  current_occupancy_bags: z.number(),
  position: z.number(),
  is_active: z.boolean(),
  notes: z.string().nullable(),
});

// A lot's share of one rack — for the rack drill-down (marka is how staff
// physically identify whose stack is whose).
export const RackLotRow = z.object({
  lot_id: z.string().uuid(),
  lot_number: z.string(),
  owner_party_name: z.string().nullable(),
  commodity_name: z.string().nullable(),
  marka: z.string().nullable(),
  bags: z.number(),
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
  rack_count: z.number().optional(),
  racks: z.array(RackResponse).optional(),
  unplaced_bags: z.number().optional(),
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
