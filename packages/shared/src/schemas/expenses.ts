import { z } from 'zod';
import { BookType } from './enums';

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

/**
 * Expense vouchers are retired (docs/25 C-03): costs are supplier bills. Existing
 * vouchers stay readable; a draft or approved one can only be cancelled and an
 * accrued one is converted to a bill.
 */
export const ExpenseVoucherStatus = z.enum(['DRAFT', 'APPROVED', 'ACCRUED', 'PAID', 'CANCELLED', 'CONVERTED']);

export const ExpensePaymentMethod = z.enum(['CASH', 'CHEQUE', 'BANK_TRANSFER']);

/**
 * The classes a cost may be booked to. The rest of the rule lives on the chart row: the
 * account must be an active DETAIL that a person may post to (`allow_manual_posting`),
 * which is what keeps payroll, depreciation, bad-debt and disposal accounts — each moved
 * by its own flow — out of every expense picker and every bill (docs/25 C-05).
 */
export const EXPENSE_ACCOUNT_CLASSES: readonly string[] = ['EXPENSE', 'COST_OF_SERVICE'];

export const CancelExpenseRequest = z.object({ reason: z.string().optional() });

/** Move an accrued voucher's liability onto a supplier's account as a bill. */
export const ConvertExpenseVoucherRequest = z.object({
  supplier_party_id: z.string().uuid(),
  /** When the liability moves — defaults to today; not before the voucher's own date. */
  conversion_date: dateOnly.optional(),
  due_date: dateOnly.nullable().optional(),
});
export type ConvertExpenseVoucherRequestType = z.infer<typeof ConvertExpenseVoucherRequest>;

export const ExpenseVoucherAction = z.enum(['cancel', 'convert_to_bill']);
export type ExpenseVoucherActionType = z.infer<typeof ExpenseVoucherAction>;

export const ExpenseVoucherListQuery = z.object({
  status: ExpenseVoucherStatus.optional(),
  expense_account_code: z.string().optional(),
  date_from: dateOnly.optional(),
  date_to: dateOnly.optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});
export type ExpenseVoucherListQueryType = z.infer<typeof ExpenseVoucherListQuery>;

export const ExpenseVoucherResponse = z.object({
  id: z.string().uuid(),
  voucher_number: z.string(),
  voucher_date: z.string(),
  payment_date: z.string().nullable(),
  expense_account_code: z.string(),
  description: z.string(),
  vendor_name: z.string().nullable(),
  reference_number: z.string().nullable(),
  amount_pkr: z.number(),
  payment_method: ExpensePaymentMethod.nullable(),
  asset_account_code: z.string().nullable(),
  is_accrual: z.boolean(),
  status: ExpenseVoucherStatus,
  book_type: BookType,
  accrual_journal_entry_id: z.string().uuid().nullable(),
  payment_journal_entry_id: z.string().uuid().nullable(),
  /** The bill an accrued voucher was converted to. */
  bill_id: z.string().uuid().nullable(),
  receipt_url: z.string().nullable(),
  approved_by: z.string().uuid().nullable(),
  approved_at: z.string().nullable(),
  notes: z.string().nullable(),
  allowed_actions: z.array(ExpenseVoucherAction),
  created_at: z.string(),
});
export type ExpenseVoucherResponseType = z.infer<typeof ExpenseVoucherResponse>;
