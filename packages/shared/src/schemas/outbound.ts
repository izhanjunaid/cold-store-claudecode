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

// ── Dispatch desk ────────────────────────────────────────────────────────────

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

/** GET /v1/outbound-events — the desk's queue. `status` is a comma-separated list. */
export const OutboundListQuery = z.object({
  status: z.string().trim().min(1).optional(),
  date_from: dateOnly.optional(),
  date_to: dateOnly.optional(),
  /** Dispatch note number, vehicle plate or lot number. */
  search: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(30),
});
export type OutboundListQueryType = z.infer<typeof OutboundListQuery>;

export const DispatchPaymentMode = z.enum(['CASH', 'BANK_TRANSFER', 'CHEQUE', 'MOBILE_WALLET', 'CREDIT']);
export type DispatchPaymentModeType = z.infer<typeof DispatchPaymentMode>;

/**
 * POST /v1/outbound-events/:id/dispatch-and-collect — dispatch the weighed withdrawal,
 * finalize its bill and take the money in one transaction. The client sends the total
 * it showed; a different total on the server is refused (what was reviewed is what posts).
 */
export const DispatchAndCollectRequest = z
  .object({
    expected_total_pkr: z.number().nonnegative(),
    picked_from: z
      .array(z.object({ rack_id: z.string().uuid(), bags: z.number().int().positive() }))
      .optional(),
    /** Pre-added service lines (apply_at_dispatch) to leave off this bill. Needs invoices.manage. */
    skip_service_charge_ids: z.array(z.string().uuid()).optional(),
    payment: z.object({
      mode: DispatchPaymentMode,
      reference_number: z.string().trim().max(100).optional(),
      cheque_date: dateOnly.optional(),
    }),
    notes: z.string().optional(),
  })
  .refine((b) => b.payment.mode !== 'CHEQUE' || !!b.payment.cheque_date, {
    message: 'A cheque needs its date',
    path: ['payment', 'cheque_date'],
  });
export type DispatchAndCollectRequestType = z.infer<typeof DispatchAndCollectRequest>;