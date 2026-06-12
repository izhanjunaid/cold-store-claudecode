import { z } from 'zod';

// One row per overdue invoice the rule engine suggests a surcharge for
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

// An applied surcharge record
export const SurchargeResponse = z.object({
  id: z.string().uuid(),
  invoice_id: z.string().uuid(),
  surcharge_date: z.string(),
  months_charged: z.number().int(),
  base_outstanding_pkr: z.number(),
  rate_pct_per_month: z.number(),
  amount_pkr: z.number(),
  journal_entry_id: z.string().uuid().nullable(),
  notes: z.string().nullable(),
  created_at: z.string(),
});
export type SurchargeResponseType = z.infer<typeof SurchargeResponse>;
