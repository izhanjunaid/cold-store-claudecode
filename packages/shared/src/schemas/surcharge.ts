import { z } from 'zod';

// One row per overdue invoice the rule engine suggests a surcharge for.
export const SurchargeSuggestion = z.object({
  invoice_id: z.string().uuid(),
  invoice_number: z.string().nullable(),
  billing_party_id: z.string().uuid(),
  billing_party_name: z.string(),
  invoice_date: z.string(),
  days_overdue: z.number().int(),
  chargeable_months: z.number().int(),
  base_outstanding_pkr: z.number(),
  rate_pct_per_month: z.number(),
  suggested_amount_pkr: z.number(),
});
export type SurchargeSuggestionType = z.infer<typeof SurchargeSuggestion>;

export const SurchargeSuggestionsResponse = z.object({
  enabled: z.boolean(),
  pct_per_month: z.number(),
  grace_days: z.number().int(),
  as_of: z.string(),
  suggestions: z.array(SurchargeSuggestion),
});
export type SurchargeSuggestionsResponseType = z.infer<typeof SurchargeSuggestionsResponse>;

export const ApplySurchargeRequest = z.object({
  as_of_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes: z.string().max(400).optional(),
});
export type ApplySurchargeRequestType = z.infer<typeof ApplySurchargeRequest>;

// A posted surcharge — one journal entry per chargeable month (the GL is the
// system of record; there is no separate surcharge table).
export const AppliedSurcharge = z.object({
  journal_entry_id: z.string().uuid(),
  entry_number: z.string(),
  entry_date: z.string(),
  amount_pkr: z.number(),
  description: z.string(),
});
export type AppliedSurchargeType = z.infer<typeof AppliedSurcharge>;

export const SurchargeApplyResponse = z.object({
  invoice_id: z.string().uuid(),
  months_charged: z.number().int(),
  amount_pkr: z.number(),
  surcharges: z.array(AppliedSurcharge),
});
export type SurchargeApplyResponseType = z.infer<typeof SurchargeApplyResponse>;

export const InvoiceSurchargesResponse = z.object({
  invoice_id: z.string().uuid(),
  total_pkr: z.number(),
  surcharges: z.array(AppliedSurcharge),
});
export type InvoiceSurchargesResponseType = z.infer<typeof InvoiceSurchargesResponse>;
