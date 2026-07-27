import { z } from 'zod';
import { DEFAULT_BANK_ACCOUNT_CODE } from '../accounting-accounts';
import { BookType } from './enums';

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

export const EmployeeType = z.enum(['SALARIED', 'DAILY_WAGE']);
export const PayrollType = z.enum(['MONTHLY_SALARY', 'DAILY_WAGES']);
export const PayrollRunStatus = z.enum(['DRAFT', 'FINALIZED', 'PAID']);

export const CreateEmployeeRequest = z
  .object({
    name: z.string().min(1).max(200),
    name_urdu: z.string().max(200).nullable().optional(),
    cnic: z.string().max(15).nullable().optional(),
    employee_type: EmployeeType,
    designation: z.string().max(100).nullable().optional(),
    join_date: dateOnly,
    basic_salary_pkr: z.number().nonnegative().optional(),
    daily_wage_pkr: z.number().nonnegative().optional(),
    eobi_registered: z.boolean().optional(),
    bank_account_number: z.string().max(30).nullable().optional(),
    bank_name: z.string().max(100).nullable().optional(),
    notes: z.string().optional(),
  })
  .refine((b) => (b.employee_type === 'SALARIED' ? !!b.basic_salary_pkr : true), {
    message: 'basic_salary_pkr required for SALARIED',
    path: ['basic_salary_pkr'],
  })
  .refine((b) => (b.employee_type === 'DAILY_WAGE' ? !!b.daily_wage_pkr : true), {
    message: 'daily_wage_pkr required for DAILY_WAGE',
    path: ['daily_wage_pkr'],
  });
export type CreateEmployeeRequestType = z.infer<typeof CreateEmployeeRequest>;

export const UpdateEmployeeRequest = z.object({
  name: z.string().min(1).max(200).optional(),
  name_urdu: z.string().max(200).nullable().optional(),
  cnic: z.string().max(15).nullable().optional(),
  designation: z.string().max(100).nullable().optional(),
  basic_salary_pkr: z.number().nonnegative().optional(),
  daily_wage_pkr: z.number().nonnegative().optional(),
  eobi_registered: z.boolean().optional(),
  bank_account_number: z.string().max(30).nullable().optional(),
  bank_name: z.string().max(100).nullable().optional(),
  is_active: z.boolean().optional(),
  notes: z.string().optional(),
});
export type UpdateEmployeeRequestType = z.infer<typeof UpdateEmployeeRequest>;

export const TerminateEmployeeRequest = z.object({
  termination_date: dateOnly,
});
export type TerminateEmployeeRequestType = z.infer<typeof TerminateEmployeeRequest>;

export const EmployeeListQuery = z.object({
  employee_type: EmployeeType.optional(),
  is_active: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(50),
});
export type EmployeeListQueryType = z.infer<typeof EmployeeListQuery>;

export const EmployeeResponse = z.object({
  id: z.string().uuid(),
  name: z.string(),
  name_urdu: z.string().nullable(),
  cnic: z.string().nullable(),
  employee_type: EmployeeType,
  designation: z.string().nullable(),
  join_date: z.string(),
  basic_salary_pkr: z.number().nullable(),
  daily_wage_pkr: z.number().nullable(),
  eobi_registered: z.boolean(),
  bank_account_number: z.string().nullable(),
  bank_name: z.string().nullable(),
  is_active: z.boolean(),
  termination_date: z.string().nullable(),
  notes: z.string().nullable(),
  created_at: z.string(),
});
export type EmployeeResponseType = z.infer<typeof EmployeeResponse>;

export const CreatePayrollRunRequest = z.object({
  payroll_type: PayrollType,
  period_year: z.number().int().min(2020).max(2100),
  period_month: z.number().int().min(1).max(12),
  period_from: dateOnly,
  period_to: dateOnly,
  book_type: BookType.optional(),
  notes: z.string().optional(),
});
export type CreatePayrollRunRequestType = z.infer<typeof CreatePayrollRunRequest>;

export const UpdatePayrollLineRequest = z.object({
  days_worked: z.number().nonnegative().optional(),
  gross_pay_pkr: z.number().nonnegative().optional(),
  eobi_employee_pkr: z.number().nonnegative().optional(),
  eobi_employer_pkr: z.number().nonnegative().optional(),
  income_tax_pkr: z.number().nonnegative().optional(),
  other_deductions_pkr: z.number().nonnegative().optional(),
  advance_recovery_pkr: z.number().nonnegative().optional(),
});
export type UpdatePayrollLineRequestType = z.infer<typeof UpdatePayrollLineRequest>;

export const FinalizePayrollRequest = z.object({}).optional();

export const PayPayrollRequest = z.object({
  payment_date: dateOnly,
  from_asset_account_code: z.string().regex(/^[0-9]+$/).default(DEFAULT_BANK_ACCOUNT_CODE),
});
export type PayPayrollRequestType = z.infer<typeof PayPayrollRequest>;

export const ReversePayrollRunRequest = z.object({
  reason: z.string().min(1).max(400),
  reversal_date: dateOnly.optional(),
});
export type ReversePayrollRunRequestType = z.infer<typeof ReversePayrollRunRequest>;

export const RemitGovtRequest = z.object({
  remittance_date: dateOnly,
  from_asset_account_code: z.string().regex(/^[0-9]+$/).default(DEFAULT_BANK_ACCOUNT_CODE),
  remit_employee_eobi_pkr: z.number().nonnegative(),
  remit_employer_eobi_pkr: z.number().nonnegative(),
  remit_income_tax_pkr: z.number().nonnegative().default(0),
});
export type RemitGovtRequestType = z.infer<typeof RemitGovtRequest>;

export const PayrollLineItemResponse = z.object({
  id: z.string().uuid(),
  employee_id: z.string().uuid(),
  employee_name: z.string(),
  employee_type: EmployeeType,
  days_worked: z.number().nullable(),
  gross_pay_pkr: z.number(),
  eobi_employee_pkr: z.number(),
  eobi_employer_pkr: z.number(),
  income_tax_pkr: z.number(),
  other_deductions_pkr: z.number(),
  advance_recovery_pkr: z.number(),
  net_pay_pkr: z.number(),
});
export type PayrollLineItemResponseType = z.infer<typeof PayrollLineItemResponse>;

export const PayrollRunResponse = z.object({
  id: z.string().uuid(),
  run_number: z.string(),
  payroll_type: PayrollType,
  period_year: z.number().int(),
  period_month: z.number().int(),
  period_from: z.string(),
  period_to: z.string(),
  total_gross_pkr: z.number(),
  total_deductions_pkr: z.number(),
  total_employer_eobi_pkr: z.number(),
  total_net_payable_pkr: z.number(),
  status: PayrollRunStatus,
  book_type: BookType,
  payroll_journal_entry_id: z.string().uuid().nullable(),
  payment_journal_entry_id: z.string().uuid().nullable(),
  remittance_journal_entry_id: z.string().uuid().nullable(),
  finalized_at: z.string().nullable(),
  paid_at: z.string().nullable(),
  notes: z.string().nullable(),
  line_items: z.array(PayrollLineItemResponse).optional(),
  created_at: z.string(),
});
export type PayrollRunResponseType = z.infer<typeof PayrollRunResponse>;

export const PayrollRunListQuery = z.object({
  payroll_type: PayrollType.optional(),
  status: PayrollRunStatus.optional(),
  period_year: z.coerce.number().int().optional(),
  period_month: z.coerce.number().int().optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});
export type PayrollRunListQueryType = z.infer<typeof PayrollRunListQuery>;
