import { z } from 'zod';

/**
 * A manager's standing pre-approval of credit for one party (migration 0040). While it
 * holds, a credit-billed truck of the party leaves the gate without a manager present.
 */
export const CreateCreditApprovalRequest = z.object({
  /** The most the party may owe (both books) while this approval carries a truck out. */
  max_outstanding_pkr: z.number().positive().max(999_999_999_999.99),
  /** Last business day it holds (YYYY-MM-DD); omit for "until revoked". */
  valid_until: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
  note: z.string().trim().max(400).optional(),
});
export type CreateCreditApprovalRequestType = z.infer<typeof CreateCreditApprovalRequest>;

export const RevokeCreditApprovalRequest = z.object({
  reason: z.string().trim().min(3).max(400),
});
export type RevokeCreditApprovalRequestType = z.infer<typeof RevokeCreditApprovalRequest>;

/**
 * What a reader gets. The ceiling is commercial and a rupee figure can stand in for a bag
 * count, so only holders of `parties.credit_terms` see it (the others get `approved` and
 * the date); the gate guard gets none of this at all.
 */
export const CreditApprovalResponse = z.object({
  approved: z.boolean(),
  id: z.string().uuid().nullable(),
  max_outstanding_pkr: z.number().nullable(),
  valid_until: z.string().nullable(),
  approved_by_name: z.string().nullable(),
  approved_at: z.string().nullable(),
  note: z.string().nullable(),
});
export type CreditApprovalResponseType = z.infer<typeof CreditApprovalResponse>;
