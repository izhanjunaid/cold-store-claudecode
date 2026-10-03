import { z } from 'zod';
import { DEFAULT_BANK_ACCOUNT_CODE, SYSTEM_ACCOUNTS } from '../accounting-accounts';
import { round2, sumMoney } from '../money';
import { BookType } from './enums';

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

export const EmployeeType = z.enum(['SALARIED', 'DAILY_WAGE']);
export const PayrollType = z.enum(['MONTHLY_SALARY', 'DAILY_WAGES']);
export const PayrollRunStatus = z.enum(['DRAFT', 'FINALIZED', 'PAID', 'REVERSED']);

/**
 * Where an employee's pay is expensed — by what they do, not how they are paid
 * (docs/25 C-16): a salaried plant operator is direct labour, a daily-wage clerk
 * is overhead. A closed set, each with the account its employer EOBI pairs with.
 */
export const PAYROLL_COST_ACCOUNTS = {
  [SYSTEM_ACCOUNTS.SALARIES_OFFICE]: {
    employerEobi: SYSTEM_ACCOUNTS.SALARIES_OFFICE_EOBI,
    label: 'Management & office (overhead)',
  },
  [SYSTEM_ACCOUNTS.DIRECT_LABOUR]: {
    employerEobi: SYSTEM_ACCOUNTS.DIRECT_LABOUR_EOBI,
    label: 'Direct labour (cost of service)',
  },
} as const;
export const PayrollCostAccount = z.enum([SYSTEM_ACCOUNTS.SALARIES_OFFICE, SYSTEM_ACCOUNTS.DIRECT_LABOUR]);
export type PayrollCostAccountType = z.infer<typeof PayrollCostAccount>;

export const DEFAULT_PAYROLL_COST_ACCOUNT: Record<z.infer<typeof EmployeeType>, PayrollCostAccountType> = {
  SALARIED: SYSTEM_ACCOUNTS.SALARIES_OFFICE,
  DAILY_WAGE: SYSTEM_ACCOUNTS.DIRECT_LABOUR,
};

/** The amounts on one payroll line that decide its net pay. */
export type PayrollLineAmounts = {
  gross_pay_pkr: number;
  eobi_employee_pkr: number;
  eobi_employer_pkr: number;
  income_tax_pkr: number;
  advance_recovery_pkr: number;
};

/** Net pay of one line: gross less the employee's EOBI, income tax and advance recovery. */
export function payrollLineNet(l: PayrollLineAmounts): number {
  return round2(l.gross_pay_pkr - l.eobi_employee_pkr - l.income_tax_pkr - l.advance_recovery_pkr);
}

/**
 * A run's totals, from its lines. The one implementation: the draft, a line edit,
 * finalize, payment and the run screen all used to sum the lines themselves, and
 * the payment paid a stored total the accrual had recomputed (docs/25 C-23).
 */
export function payrollRunTotals(lines: PayrollLineAmounts[]) {
  const gross = sumMoney(lines.map((l) => l.gross_pay_pkr));
  const employeeEobi = sumMoney(lines.map((l) => l.eobi_employee_pkr));
  const employerEobi = sumMoney(lines.map((l) => l.eobi_employer_pkr));
  const incomeTax = sumMoney(lines.map((l) => l.income_tax_pkr));
  const advanceRecovery = sumMoney(lines.map((l) => l.advance_recovery_pkr));
  const net = sumMoney(lines.map(payrollLineNet));
  return {
    gross,
    employeeEobi,
    employerEobi,
    incomeTax,
    advanceRecovery,
    net,
    deductions: round2(employeeEobi + incomeTax + advanceRecovery),
  };
}

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
    /** Defaults from the employee type when omitted. */
    cost_account_code: PayrollCostAccount.optional(),
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
  cost_account_code: PayrollCostAccount.optional(),
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
  cost_account_code: z.string(),
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

/**
 * A daily-wage line's gross is days worked x daily wage, computed by the server;
 * a salaried line has no days worked. Net pay is always derived.
 */
export const UpdatePayrollLineRequest = z.object({
  days_worked: z.number().nonnegative().optional(),
  gross_pay_pkr: z.number().nonnegative().optional(),
  eobi_employee_pkr: z.number().nonnegative().optional(),
  eobi_employer_pkr: z.number().nonnegative().optional(),
  income_tax_pkr: z.number().nonnegative().optional(),
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

/** Void a salary payment made in error: reverses JE-16 and returns the run to FINALIZED (docs/25 C-15). */
export const VoidPayrollPaymentRequest = z.object({
  reason: z.string().min(1).max(400),
  void_date: dateOnly.optional(),
});
export type VoidPayrollPaymentRequestType = z.infer<typeof VoidPayrollPaymentRequest>;

/** What the server will let a run do next, by its state alone (the web adds permissions). */
export const PayrollRunAction = z.enum(['edit_lines', 'finalize', 'pay', 'void_payment', 'reverse']);
export type PayrollRunActionType = z.infer<typeof PayrollRunAction>;

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
  voided_at: z.string().nullable(),
  void_reason: z.string().nullable(),
  allowed_actions: z.array(PayrollRunAction),
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
