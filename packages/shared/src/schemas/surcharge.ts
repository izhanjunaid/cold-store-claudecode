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
});
export type ApplySurchargeRequestType = z.infer<typeof ApplySurchargeRequest>;

// A surcharge charged on an invoice: a SURCHARGE invoice of its own (docs/25 R-08),
// or — status LEGACY — a JE-21 an older version posted straight to AR, one per month.
export const AppliedSurcharge = z.object({
  invoice_id: z.string().uuid().nullable(),
  invoice_number: z.string().nullable(),
  journal_entry_id: z.string().uuid().nullable(),
  entry_number: z.string().nullable(),
  entry_date: z.string(),
  months: z.number(),
  amount_pkr: z.number(),
  status: z.enum(['DRAFT', 'FINALIZED', 'VOID', 'WRITTEN_OFF', 'LEGACY']),
  description: z.string(),
});
export type AppliedSurchargeType = z.infer<typeof AppliedSurcharge>;

export const SurchargeApplyResponse = z.object({
  invoice_id: z.string().uuid(),
  months_charged: z.number().int(),
  amount_pkr: z.number(),
  surcharge_invoice_id: z.string().uuid(),
  surcharge_invoice_number: z.string(),
});
export type SurchargeApplyResponseType = z.infer<typeof SurchargeApplyResponse>;

export const InvoiceSurchargesResponse = z.object({
  invoice_id: z.string().uuid(),
  total_pkr: z.number(),
  surcharges: z.array(AppliedSurcharge),
});
export type InvoiceSurchargesResponseType = z.infer<typeof InvoiceSurchargesResponse>;
