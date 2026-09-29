import { z } from 'zod';
import { BookType, EmployeeAdvanceStatus } from './enums';

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

// One active advance per employee, capped at one month's pay — see IssueEmployeeAdvanceRequest.
export { EmployeeAdvanceStatus };

export const IssueEmployeeAdvanceRequest = z.object({
  employee_id: z.string().uuid(),
  issue_date: dateOnly,
  principal_pkr: z.number().positive(),
  monthly_installment_pkr: z.number().positive(),
  // Any account the chart flags as cash or bank (docs/25 C-06/C-07).
  source_asset_account_code: z.string().regex(/^[0-9]+$/),
  book_type: BookType.optional(),
  notes: z.string().optional(),
});
export type IssueEmployeeAdvanceRequestType = z.infer<typeof IssueEmployeeAdvanceRequest>;

export const WriteOffEmployeeAdvanceRequest = z.object({
  reason: z.string().trim().min(3),
  write_off_date: dateOnly.optional(),
});
export type WriteOffEmployeeAdvanceRequestType = z.infer<typeof WriteOffEmployeeAdvanceRequest>;

// Void an advance issued in error: reverses its issue entry. Only while nothing has
// been recovered (docs/25 C-26).
export const VoidEmployeeAdvanceRequest = z.object({
  reason: z.string().trim().min(3),
  void_date: dateOnly.optional(),
});
export type VoidEmployeeAdvanceRequestType = z.infer<typeof VoidEmployeeAdvanceRequest>;

// The employee pays back in cash; the money lands in a cash or bank account.
export const RecordEmployeeAdvanceRepaymentRequest = z.object({
  repayment_date: dateOnly,
  amount_pkr: z.number().positive(),
  asset_account_code: z.string().regex(/^[0-9]+$/),
});
export type RecordEmployeeAdvanceRepaymentRequestType = z.infer<typeof RecordEmployeeAdvanceRepaymentRequest>;

export const VoidEmployeeAdvanceRepaymentRequest = z.object({
  reason: z.string().trim().min(3),
  void_date: dateOnly.optional(),
});
export type VoidEmployeeAdvanceRepaymentRequestType = z.infer<typeof VoidEmployeeAdvanceRepaymentRequest>;

export const EmployeeAdvanceAction = z.enum(['repay', 'write_off', 'void']);
export type EmployeeAdvanceActionType = z.infer<typeof EmployeeAdvanceAction>;

export const EmployeeAdvanceListQuery = z.object({
  employee_id: z.string().uuid().optional(),
  status: EmployeeAdvanceStatus.optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});
export type EmployeeAdvanceListQueryType = z.infer<typeof EmployeeAdvanceListQuery>;

// PAYROLL: deducted from a salary, carried inside the run's entry.
// CASH: repaid by the employee, with its own entry.
export const EmployeeAdvanceRecoveryResponse = z.object({
  id: z.string().uuid(),
  kind: z.enum(['PAYROLL', 'CASH']),
  payroll_run_id: z.string().uuid().nullable(),
  payroll_run_number: z.string().nullable(),
  journal_entry_id: z.string().uuid().nullable(),
  asset_account_code: z.string().nullable(),
  recovery_date: z.string(),
  amount_pkr: z.number(),
  voided_at: z.string().nullable(),
  created_at: z.string(),
  can_void: z.boolean(),
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
  voided_at: z.string().nullable(),
  void_reason: z.string().nullable(),
  notes: z.string().nullable(),
  created_at: z.string(),
  allowed_actions: z.array(EmployeeAdvanceAction),
  recoveries: z.array(EmployeeAdvanceRecoveryResponse).optional(),
});
export type EmployeeAdvanceResponseType = z.infer<typeof EmployeeAdvanceResponse>;
