import { z } from 'zod';
import { DEFAULT_BANK_ACCOUNT_CODE } from '../accounting-accounts';
import { BookType } from './enums';

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

export const ExpenseVoucherStatus = z.enum([
  'DRAFT',
  'APPROVED',
  'ACCRUED',
  'PAID',
  'CANCELLED',
]);

export const ExpensePaymentMethod = z.enum(['CASH', 'CHEQUE', 'BANK_TRANSFER']);

export const CreateExpenseVoucherRequest = z.object({
  voucher_date: dateOnly,
  expense_account_code: z.string().regex(/^[5-6][0-9]+$/),
  description: z.string().min(1).max(500),
  vendor_name: z.string().max(200).nullable().optional(),
  reference_number: z.string().max(100).nullable().optional(),
  amount_pkr: z.number().positive(),
  is_accrual: z.boolean().optional(),
  payment_method: ExpensePaymentMethod.optional(),
  asset_account_code: z.string().regex(/^[0-9]+$/).optional(),
  receipt_url: z.string().max(500).nullable().optional(),
  book_type: BookType.optional(),
  notes: z.string().optional(),
});
export type CreateExpenseVoucherRequestType = z.infer<typeof CreateExpenseVoucherRequest>;

export const UpdateExpenseVoucherRequest = z.object({
  voucher_date: dateOnly.optional(),
  expense_account_code: z.string().regex(/^[5-6][0-9]+$/).optional(),
  description: z.string().min(1).max(500).optional(),
  vendor_name: z.string().max(200).nullable().optional(),
  reference_number: z.string().max(100).nullable().optional(),
  amount_pkr: z.number().positive().optional(),
  payment_method: ExpensePaymentMethod.optional(),
  asset_account_code: z.string().regex(/^[0-9]+$/).optional(),
  receipt_url: z.string().max(500).nullable().optional(),
  notes: z.string().optional(),
});
export type UpdateExpenseVoucherRequestType = z.infer<typeof UpdateExpenseVoucherRequest>;

export const ApproveExpenseRequest = z.object({}).optional();
export const CancelExpenseRequest = z.object({ reason: z.string().optional() });

export const AccrueExpenseRequest = z.object({}).optional();

export const PayExpenseRequest = z.object({
  payment_date: dateOnly,
  payment_method: ExpensePaymentMethod,
  asset_account_code: z.string().regex(/^[0-9]+$/),
});
export type PayExpenseRequestType = z.infer<typeof PayExpenseRequest>;

export const PettyCashReplenishRequest = z.object({
  replenishment_date: dateOnly,
  amount_pkr: z.number().positive(),
  source_bank_account_code: z.string().regex(/^[0-9]+$/).default(DEFAULT_BANK_ACCOUNT_CODE),
  book_type: BookType.optional(),
});
export type PettyCashReplenishRequestType = z.infer<typeof PettyCashReplenishRequest>;

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
  receipt_url: z.string().nullable(),
  approved_by: z.string().uuid().nullable(),
  approved_at: z.string().nullable(),
  notes: z.string().nullable(),
  created_at: z.string(),
});
export type ExpenseVoucherResponseType = z.infer<typeof ExpenseVoucherResponse>;
