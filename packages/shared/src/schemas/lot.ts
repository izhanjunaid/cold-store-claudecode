import { z } from 'zod';
import { LotStatus, BookType } from './enums';
import { PaginationQuery } from './common';

export const CreateLotRequest = z.object({
  owner_party_id: z.string().uuid(),
  billing_party_id: z.string().uuid().optional(),
  commodity_id: z.string().uuid(),
  variety_id: z.string().uuid().optional(),
  rate_plan_id: z.string().uuid(),
  chamber_id: z.string().uuid(),
  quantity_bags: z.number().int().positive(),
  accepted_weight_kg: z.number().positive(),
  declared_weight_kg: z.number().positive().optional(),
  weight_dispute_note: z.string().optional(),
  quality_grade_inbound: z.enum(['A', 'B', 'C']).optional(),
  inbound_date: z.string().date().optional(),
  vehicle_number: z.string().max(20).optional(),
  marka: z.string().max(100).optional(),
  notes: z.string().optional(),
  book_type: BookType.optional(),
});

// PATCH only allows metadata edits in Phase 2
export const UpdateLotRequest = z.object({
  notes: z.string().optional(),
  quality_grade_inbound: z.enum(['A', 'B', 'C']).optional(),
  marka: z.string().max(100).optional(),
});

export const LotListQuery = PaginationQuery.extend({
  status: LotStatus.optional(),
  party_id: z.string().uuid().optional(),
  commodity_id: z.string().uuid().optional(),
  chamber_id: z.string().uuid().optional(),
  inbound_date_from: z.string().date().optional(),
  inbound_date_to: z.string().date().optional(),
  marka: z.string().optional(),
  search: z.string().optional(),
});

export const LotResponse = z.object({
  id: z.string().uuid(),
  facility_id: z.string().uuid(),
  lot_number: z.string(),
  chamber_id: z.string().uuid(),
  chamber_name: z.string().nullable(),
  owner_party_id: z.string().uuid(),
  owner_party_name: z.string().nullable(),
  billing_party_id: z.string().uuid(),
  billing_party_name: z.string().nullable(),
  commodity_id: z.string().uuid(),
  commodity_name: z.string().nullable(),
  variety_id: z.string().uuid().nullable(),
  variety_name: z.string().nullable(),
  rate_plan_id: z.string().uuid(),
  rate_plan_name: z.string().nullable(),
  quantity_bags: z.number(),
  current_balance_bags: z.number(),
  accepted_weight_kg: z.number(),
  declared_weight_kg: z.number().nullable(),
  weight_dispute_flag: z.boolean(),
  weight_dispute_note: z.string().nullable(),
  quality_grade_inbound: z.string().nullable(),
  inbound_date: z.string(),
  entry_date: z.string(),
  parent_lot_id: z.string().uuid().nullable(),
  vehicle_number: z.string().nullable(),
  marka: z.string().nullable(),
  status: LotStatus,
  closed_at: z.string().nullable(),
  book_type: BookType,
  notes: z.string().nullable(),
  days_in_storage: z.number(),
  created_at: z.string(),
  created_by: z.string().uuid(),
});

export const OwnershipHistoryResponse = z.object({
  id: z.string().uuid(),
  lot_id: z.string().uuid(),
  event_type: z.enum(['INITIAL', 'TRANSFER_IN', 'TRANSFER_OUT']),
  from_party_id: z.string().uuid().nullable(),
  from_party_name: z.string().nullable(),
  to_party_id: z.string().uuid(),
  to_party_name: z.string().nullable(),
  quantity_bags: z.number(),
  transfer_price_pkr: z.number().nullable(),
  effective_date: z.string(),
  operator_id: z.string().uuid(),
  operator_name: z.string().nullable(),
  notes: z.string().nullable(),
  created_at: z.string(),
});
