import { z } from 'zod';
import { WithdrawalType, OutboundStatus } from './enums';
import { VehicleNumber } from '../vehicle';

export const CreateOutboundRequest = z.object({
  lot_id: z.string().uuid(),
  withdrawal_type: WithdrawalType,
  quantity_withdrawn_bags: z.number().int().positive(),
  outbound_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  receiving_party_id: z.string().uuid().optional(),
  third_party_release: z.boolean().optional(),
  vehicle_number: VehicleNumber.optional(),
  notes: z.string().optional(),
});
export type CreateOutboundRequest = z.infer<typeof CreateOutboundRequest>;

/** Cancel a withdrawal that has not left (PENDING, WEIGHED or DISPUTED); the lot is untouched. */
export const CancelOutboundRequest = z.object({
  reason: z.string().trim().min(3).max(400),
});
export type CancelOutboundRequest = z.infer<typeof CancelOutboundRequest>;

export const UpdateOutboundWeightRequest = z.object({
  outbound_weight_kg: z.number().positive(),
});
export type UpdateOutboundWeightRequest = z.infer<typeof UpdateOutboundWeightRequest>;

export const FinalizeOutboundRequest = z.object({
  notes: z.string().optional(),
  // Which racks the withdrawn bags were physically picked from. Optional:
  // any shortfall is auto-trimmed from the lot's largest placements. Applied
  // here (not at create) so cancelled withdrawals never touch placements.
  picked_from: z
    .array(z.object({ rack_id: z.string().uuid(), bags: z.number().int().positive() }))
    .optional(),
});
export type FinalizeOutboundRequest = z.infer<typeof FinalizeOutboundRequest>;

export const OutboundEventResponse = z.object({
  id: z.string().uuid(),
  lot_id: z.string().uuid(),
  lot_number: z.string(),
  facility_id: z.string().uuid(),
  withdrawal_type: WithdrawalType,
  quantity_withdrawn_bags: z.number(),
  outbound_weight_kg: z.number().nullable(),
  outbound_date: z.string(),
  receiving_party_id: z.string().uuid().nullable(),
  receiving_party_name: z.string().nullable(),
  owner_party_id_snapshot: z.string().uuid().nullable(),
  owner_party_name: z.string().nullable(),
  vehicle_number: z.string().nullable(),
  dispatch_note_number: z.string().nullable(),
  invoice_id: z.string().uuid().nullable(),
  status: OutboundStatus,
  notes: z.string().nullable(),
  prorated_inbound_weight_kg: z.number().nullable(),
  weight_variance_pct: z.number().nullable(),
  created_at: z.string(),
  created_by_name: z.string(),
  finalized_at: z.string().nullable().optional(),
  voided_at: z.string().nullable().optional(),
  void_reason: z.string().nullable().optional(),
  gate_pass_id: z.string().uuid().nullable().optional(),
});
export type OutboundEventResponse = z.infer<typeof OutboundEventResponse>;
