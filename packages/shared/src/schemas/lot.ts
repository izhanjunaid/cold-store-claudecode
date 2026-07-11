import { z } from 'zod';
import { LotStatus, BookType, LotMovementType } from './enums';
import { PaginationQuery } from './common';

// One rack allocation: used at lot creation, placement updates, and room moves.
export const LotPlacementInput = z.object({
  rack_id: z.string().uuid(),
  bags: z.number().int().positive(),
});

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
  placements: z.array(LotPlacementInput).optional(),
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

// ── Rack placements & movements (Rooms & Racks) ──────────────────

export const SetLotPlacementsRequest = z.object({
  placements: z.array(LotPlacementInput),
});

export const LotPlacementRow = z.object({
  rack_id: z.string().uuid(),
  rack_name: z.string(),
  bags: z.number(),
});

export const LotPlacementsResponse = z.object({
  lot_id: z.string().uuid(),
  chamber_id: z.string().uuid(),
  chamber_name: z.string().nullable(),
  current_balance_bags: z.number(),
  placements: z.array(LotPlacementRow),
  unplaced_bags: z.number(),
});

// RACK: partial move between two racks of the lot's room.
// ROOM: whole-lot move to another room (optionally with immediate placements).
export const MoveLotRequest = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('RACK'),
    from_rack_id: z.string().uuid(),
    to_rack_id: z.string().uuid(),
    bags: z.number().int().positive(),
    reason: z.string().max(500).optional(),
  }),
  z.object({
    type: z.literal('ROOM'),
    to_chamber_id: z.string().uuid(),
    placements: z.array(LotPlacementInput).optional(),
    reason: z.string().max(500).optional(),
  }),
]);

export const LotMovementResponse = z.object({
  id: z.string().uuid(),
  lot_id: z.string().uuid(),
  movement_type: LotMovementType,
  from_chamber_id: z.string().uuid().nullable(),
  from_chamber_name: z.string().nullable(),
  to_chamber_id: z.string().uuid().nullable(),
  to_chamber_name: z.string().nullable(),
  from_rack_id: z.string().uuid().nullable(),
  from_rack_name: z.string().nullable(),
  to_rack_id: z.string().uuid().nullable(),
  to_rack_name: z.string().nullable(),
  bags: z.number(),
  reason: z.string().nullable(),
  moved_by: z.string().uuid(),
  moved_by_name: z.string().nullable(),
  moved_at: z.string(),
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
