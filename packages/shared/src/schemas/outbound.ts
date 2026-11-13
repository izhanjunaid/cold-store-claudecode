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
  quantity_withdrawn_bags: z.number().nullable(),
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

/** Most lines one truck checkout takes (the original D3 design: about 20). */
export const TRUCK_MAX_LINES = 20;

/**
 * Why a manager must finish a checkout (docs/28 D6). The first four are the solo rules (the owner's
 * switch, the book, the date, a per-ton charge); the rest are what the munshi asked the checkout to do.
 * A refusal carries the code in `details.reason_code`; the previews in `solo.reason_code`.
 */
export const MANAGER_REASON_CODES = [
  'SOLO_OFF',
  'KATCHI',
  'NOT_TODAY',
  'PER_TON_CHARGE',
  'SKIP_CHARGE',
  'NO_STANDING_CREDIT',
  'PAYMENT_MODE',
  'OVER_CREDIT_CEILING',
] as const;
export type ManagerReasonCode = (typeof MANAGER_REASON_CODES)[number];

/** Each reason in words, as the munshi has always been told it. */
export const MANAGER_REASON_TEXT: Record<ManagerReasonCode, string> = {
  SOLO_OFF: 'the owner has not switched on one-person dispatch',
  KATCHI: 'a KATCHI-book bill is a manager decision',
  NOT_TODAY: 'a withdrawal not dated today is a manager decision',
  PER_TON_CHARGE: 'a charge priced by the weight is a manager decision',
  SKIP_CHARGE: 'leaving a charge off the bill is a manager decision',
  NO_STANDING_CREDIT: 'this party has no standing credit approval',
  PAYMENT_MODE: 'only cash or approved credit can be taken without a manager',
  OVER_CREDIT_CEILING: 'this bill would take the party past its approved credit',
};

/**
 * A munshi calls a manager on a withdrawal (docs/28 O6), saying what the buyer wants when they
 * picked it. Never which credit rule failed: the munshi is not told a party's credit standing.
 */
export const MANAGER_ASK_CODES = ['CALLED', 'CHEQUE_OR_TRANSFER', 'CREDIT', 'LEAVE_CHARGE_OFF'] as const;
export type ManagerAskCode = (typeof MANAGER_ASK_CODES)[number];

export const MANAGER_ASK_TEXT: Record<ManagerAskCode, string> = {
  CALLED: 'the desk called a manager',
  CHEQUE_OR_TRANSFER: 'the buyer pays by cheque or transfer',
  CREDIT: 'the buyer wants credit',
  LEAVE_CHARGE_OFF: 'a charge to leave off the bill',
};

/** POST /v1/dispatch/ask-manager — one withdrawal, or every line of a truck. */
export const AskManagerRequest = z.object({
  outbound_ids: z.array(z.string().uuid()).min(1).max(TRUCK_MAX_LINES),
  ask_code: z.enum(MANAGER_ASK_CODES),
});
export type AskManagerRequestType = z.infer<typeof AskManagerRequest>;

/**
 * What a manager may allow a munshi to do on a called withdrawal (docs/28 O8): the three things a munshi
 * asks for and the solo door refuses. Never a solo rule (the switch, KATCHI, an old date, a per-ton charge):
 * those stay a manager's checkout. An allowance lasts the business day it was given (O10).
 */
export const MANAGER_ALLOW_CODES = ['CHEQUE_OR_TRANSFER', 'CREDIT', 'LEAVE_CHARGE_OFF'] as const;
export type ManagerAllowCode = (typeof MANAGER_ALLOW_CODES)[number];

export const MANAGER_ALLOW_TEXT: Record<ManagerAllowCode, string> = {
  CHEQUE_OR_TRANSFER: 'cheque or transfer',
  CREDIT: 'credit on this bill',
  LEAVE_CHARGE_OFF: 'leaving charges off',
};

/** POST /v1/dispatch/allow — one withdrawal, or every ready line of a truck. An empty `allows` takes it back. */
export const AllowRequest = z.object({
  outbound_ids: z.array(z.string().uuid()).min(1).max(TRUCK_MAX_LINES),
  allows: z.array(z.enum(MANAGER_ALLOW_CODES)).max(MANAGER_ALLOW_CODES.length),
});
export type AllowRequestType = z.infer<typeof AllowRequest>;

/**
 * POST /v1/dispatch/trucks/:passId/dispatch-and-collect — check out every weighed withdrawal on a
 * truck in one transaction: each line its own bill (the total it showed is what posts), and one
 * payment row per (billing party, book) on the truck. The line cap is checked by the service so
 * the refusal is TRUCK_TOO_MANY_LINES, not a bare validation error.
 */
export const TruckDispatchRequest = z.object({
  lines: z
    .array(
      z.object({
        outbound_id: z.string().uuid(),
        expected_total_pkr: z.number().nonnegative(),
        picked_from: z
          .array(z.object({ rack_id: z.string().uuid(), bags: z.number().int().positive() }))
          .optional(),
        skip_service_charge_ids: z.array(z.string().uuid()).optional(),
      }),
    )
    .min(1),
  payments: z
    .array(
      z
        .object({
          billing_party_id: z.string().uuid(),
          book_type: z.enum(['PACCI', 'KATCHI']),
          mode: DispatchPaymentMode,
          reference_number: z.string().trim().max(100).optional(),
          cheque_date: dateOnly.optional(),
        })
        .refine((p) => p.mode !== 'CHEQUE' || !!p.cheque_date, {
          message: 'A cheque needs its date',
          path: ['cheque_date'],
        }),
    )
    .min(1),
  notes: z.string().optional(),
});
export type TruckDispatchRequestType = z.infer<typeof TruckDispatchRequest>;