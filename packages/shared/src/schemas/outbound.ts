import { z } from 'zod';
import { WithdrawalType, OutboundStatus } from './enums';

export const CreateOutboundRequest = z.object({
  lot_id: z.string().uuid(),
  withdrawal_type: WithdrawalType,
  quantity_withdrawn_bags: z.number().int().positive(),
  outbound_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  receiving_party_id: z.string().uuid().optional(),
  vehicle_number: z.string().max(20).optional(),
  notes: z.string().optional(),
});
export type CreateOutboundRequest = z.infer<typeof CreateOutboundRequest>;

export const UpdateOutboundWeightRequest = z.object({
  outbound_weight_kg: z.number().positive(),
});
export type UpdateOutboundWeightRequest = z.infer<typeof UpdateOutboundWeightRequest>;

export const FinalizeOutboundRequest = z.object({
  notes: z.string().optional(),
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
  vehicle_number: z.string().nullable(),
  dispatch_note_number: z.string().nullable(),
  status: OutboundStatus,
  notes: z.string().nullable(),
  prorated_inbound_weight_kg: z.number().nullable(),
  weight_variance_pct: z.number().nullable(),
  created_at: z.string(),
  created_by_name: z.string(),
});
export type OutboundEventResponse = z.infer<typeof OutboundEventResponse>;
