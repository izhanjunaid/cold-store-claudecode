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
/**
 * A Pakistani CNIC: 13 digits, usually written 12345-1234567-1. Payroll compares
 * on the digits alone, so either form is accepted (docs/25 C-21).
 */
const Cnic = z.string().regex(/^\d{5}-?\d{7}-?\d$/, 'Expected a 13-digit CNIC, e.g. 35202-1234567-1');

export const CreatePartnerRequest = z.object({
  name: z.string().min(1).max(200),
  admitted_on: dateOnly,
  capital_account_code: z.string().max(10).optional(),
  drawings_account_code: z.string().max(10).optional(),
  // Recorded so payroll can refuse to employ an owner: an owner's pay is a
  // drawing, never a salary (ITO 2001 s.21(j)).
  cnic: Cnic.optional(),
});
export type CreatePartnerRequestType = z.infer<typeof CreatePartnerRequest>;

export const UpdatePartnerRequest = z.object({
  name: z.string().min(1).max(200).optional(),
  // Retiring a partner stops their share after this date — their last day in.
  // It removes nothing: their accounts and history stay on every statement.
  retired_on: dateOnly.nullable().optional(),
  cnic: Cnic.nullable().optional(),
});
export type UpdatePartnerRequestType = z.infer<typeof UpdatePartnerRequest>;

export const PartnerResponse = z.object({
  id: z.string().uuid(),
  name: z.string(),
  cnic: z.string().nullable(),
  capital_account_code: z.string(),
  capital_account_name: z.string(),
  drawings_account_code: z.string(),
  drawings_account_name: z.string(),
  admitted_on: z.string(),
  retired_on: z.string().nullable(),
});
export type PartnerResponseType = z.infer<typeof PartnerResponse>;

/**
 * Move opening equity out of the plug (3010) into this owner's capital account
 * (docs/25 L-32) — the one-step replacement for a hand-written reclass.
 */
export const AttributeOpeningEquityRequest = z.object({
  amount_pkr: z.number().positive(),
  date: dateOnly,
  note: z.string().max(300).optional(),
});
export type AttributeOpeningEquityRequestType = z.infer<typeof AttributeOpeningEquityRequest>;

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
