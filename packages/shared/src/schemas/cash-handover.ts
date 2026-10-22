import { z } from 'zod';

/**
 * Cash handovers (fast-dispatch Phase C1c). A collector takes CASH receipts; a manager counts
 * that cash and records the handover. `expected_cash_pkr` is the figure the manager was shown:
 * if the pool moved since (a truck was paid meanwhile) the server refuses with the new figure
 * instead of booking a difference that is not one.
 */
export const CreateCashHandoverRequest = z.object({
  collector_id: z.string().uuid(),
  expected_cash_pkr: z.number().min(0),
  counted_cash_pkr: z.number().min(0),
  /** Required when counted differs from expected. */
  variance_reason: z.string().trim().max(400).optional(),
});
export type CreateCashHandoverRequestType = z.infer<typeof CreateCashHandoverRequest>;

export const VoidCashHandoverRequest = z.object({
  reason: z.string().trim().min(3).max(400),
});
export type VoidCashHandoverRequestType = z.infer<typeof VoidCashHandoverRequest>;

export const CashHandoverListQuery = z.object({
  collector_id: z.string().uuid().optional(),
  has_variance: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});
export type CashHandoverListQueryType = z.infer<typeof CashHandoverListQuery>;

export const DispatchDayQuery = z.object({
  /** A business day (YYYY-MM-DD); defaults to today in the facility's calendar. */
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export type DispatchDayQueryType = z.infer<typeof DispatchDayQuery>;
