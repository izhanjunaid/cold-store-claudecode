import { z } from 'zod';
import { BookType, EmployeeAdvanceStatus } from './enums';

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

// One active advance per employee, capped at one month's pay — see IssueEmployeeAdvanceRequest.
export { EmployeeAdvanceStatus };

export const IssueAdvancePaymentMethod = z.enum(['CASH', 'BANK_TRANSFER']);
export type IssueAdvancePaymentMethodType = z.infer<typeof IssueAdvancePaymentMethod>;

export const IssueEmployeeAdvanceRequest = z.object({
  employee_id: z.string().uuid(),
  issue_date: dateOnly,
  principal_pkr: z.number().positive(),
  monthly_installment_pkr: z.number().positive(),
  payment_method: IssueAdvancePaymentMethod,
  source_asset_account_code: z.string().regex(/^[0-9]+$/).optional(),
  book_type: BookType.optional(),
  notes: z.string().optional(),
});
export type IssueEmployeeAdvanceRequestType = z.infer<typeof IssueEmployeeAdvanceRequest>;

export const WriteOffEmployeeAdvanceRequest = z.object({
  reason: z.string().trim().min(3),
  write_off_date: dateOnly.optional(),
});
export type WriteOffEmployeeAdvanceRequestType = z.infer<typeof WriteOffEmployeeAdvanceRequest>;

export const EmployeeAdvanceListQuery = z.object({
  employee_id: z.string().uuid().optional(),
  status: EmployeeAdvanceStatus.optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});
export type EmployeeAdvanceListQueryType = z.infer<typeof EmployeeAdvanceListQuery>;

export const EmployeeAdvanceRecoveryResponse = z.object({
  id: z.string().uuid(),
  payroll_run_id: z.string().uuid(),
  payroll_run_number: z.string().optional(),
  recovery_date: z.string(),
  amount_pkr: z.number(),
  voided_at: z.string().nullable(),
  created_at: z.string(),
});
export type EmployeeAdvanceRecoveryResponseType = z.infer<typeof EmployeeAdvanceRecoveryResponse>;

export const EmployeeAdvanceResponse = z.object({
  id: z.string().uuid(),
  advance_number: z.string(),
  employee_id: z.string().uuid(),
  employee_name: z.string().optional(),
  issue_date: z.string(),
  principal_pkr: z.number(),
  monthly_installment_pkr: z.number(),
  balance_outstanding_pkr: z.number(),
  status: EmployeeAdvanceStatus,
  book_type: BookType,
  source_asset_account_code: z.string(),
  issue_journal_entry_id: z.string().uuid().nullable(),
  write_off_journal_entry_id: z.string().uuid().nullable(),
  write_off_reason: z.string().nullable(),
  write_off_at: z.string().nullable(),
  notes: z.string().nullable(),
  created_at: z.string(),
  recoveries: z.array(EmployeeAdvanceRecoveryResponse).optional(),
});
export type EmployeeAdvanceResponseType = z.infer<typeof EmployeeAdvanceResponse>;
