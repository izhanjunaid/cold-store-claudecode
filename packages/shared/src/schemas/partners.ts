import { z } from 'zod';

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

/**
 * An owner of the facility, and the two equity accounts that are theirs.
 *
 * Account codes are optional on create. Omitted, both accounts are created under
 * the seeded headers with codes the chart suggests. Supplied, the existing
 * accounts are **adopted** — which is the only route open on a facility that
 * already has per-owner accounts, since deleting and recreating them is possible
 * only while nothing has posted, and that window closes the first time an owner
 * takes money out.
 */
export const CreatePartnerRequest = z.object({
  name: z.string().min(1).max(200),
  admitted_on: dateOnly,
  capital_account_code: z.string().max(10).optional(),
  drawings_account_code: z.string().max(10).optional(),
});
export type CreatePartnerRequestType = z.infer<typeof CreatePartnerRequest>;

export const UpdatePartnerRequest = z.object({
  name: z.string().min(1).max(200).optional(),
  // Retiring a partner stops their share; it removes nothing. Their accounts and
  // history stay on every statement, which is what the standard requires.
  retired_on: dateOnly.nullable().optional(),
});
export type UpdatePartnerRequestType = z.infer<typeof UpdatePartnerRequest>;

export const PartnerResponse = z.object({
  id: z.string().uuid(),
  name: z.string(),
  capital_account_code: z.string(),
  capital_account_name: z.string(),
  drawings_account_code: z.string(),
  drawings_account_name: z.string(),
  admitted_on: z.string(),
  retired_on: z.string().nullable(),
});
export type PartnerResponseType = z.infer<typeof PartnerResponse>;

/**
 * The profit-sharing ratio, from a date.
 *
 * Weights are relative, not percentages: the allocator normalises over whoever
 * is effective on the date, so 1/1 and 50/50 mean the same thing and a set of
 * weights can never fail to add up to a whole. Every partner sharing from that
 * date must appear — a partial set would silently under-allocate.
 */
export const SetProfitSharesRequest = z.object({
  effective_from: dateOnly,
  shares: z
    .array(z.object({ partner_id: z.string().uuid(), weight: z.number().positive() }))
    .min(1),
});
export type SetProfitSharesRequestType = z.infer<typeof SetProfitSharesRequest>;

export const ProfitShareWindowResponse = z.object({
  effective_from: z.string(),
  shares: z.array(
    z.object({
      partner_id: z.string().uuid(),
      partner_name: z.string(),
      weight: z.number(),
      /** The weight as a share of the window's total, for display. */
      share_pct: z.number(),
    }),
  ),
});
export type ProfitShareWindowResponseType = z.infer<typeof ProfitShareWindowResponse>;
