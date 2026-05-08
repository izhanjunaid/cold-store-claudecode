export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400,
    public readonly field?: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

// Error codes from 10_api_design.md §5
export const Errors = {
  AUTH_INVALID: (msg = 'Invalid or expired token') => new AppError('AUTH_INVALID', msg, 401),
  FORBIDDEN: (msg = 'Insufficient permissions') => new AppError('FORBIDDEN', msg, 403),
  PARTY_NOT_FOUND: () => new AppError('PARTY_NOT_FOUND', 'Party does not exist', 404),
  LOT_NOT_FOUND: () => new AppError('LOT_NOT_FOUND', 'Lot does not exist', 404),
  LOT_CLOSED: () => new AppError('LOT_CLOSED', 'Lot is closed; no operations allowed', 409),
  LOT_BALANCE_INSUFFICIENT: (balance: number, requested: number) =>
    new AppError(
      'LOT_BALANCE_INSUFFICIENT',
      `Cannot withdraw ${requested} bags. Lot balance is ${balance} bags.`,
      422,
      'quantity_withdrawn_bags',
    ),
  WEIGHT_DISPUTE_UNRESOLVED: () =>
    new AppError('WEIGHT_DISPUTE_UNRESOLVED', 'Dispute note required', 422),
  INVOICE_ALREADY_FINALIZED: () =>
    new AppError('INVOICE_ALREADY_FINALIZED', 'Cannot edit finalized invoice', 409),
  CHAMBER_CAPACITY_EXCEEDED: () =>
    new AppError('CHAMBER_CAPACITY_EXCEEDED', 'Chamber at max capacity', 422),
  TRANSFER_SAME_PARTY: () =>
    new AppError('TRANSFER_SAME_PARTY', 'New owner must differ from current', 422),
  JOURNAL_UNBALANCED: () =>
    new AppError('JOURNAL_UNBALANCED', 'Debit total ≠ credit total on journal entry', 422),
  PERIOD_LOCKED: () =>
    new AppError('PERIOD_LOCKED', 'Accounting period is closed; cannot post entries', 409),
  ACCOUNT_NOT_FOUND: () =>
    new AppError('ACCOUNT_NOT_FOUND', 'Account code does not exist in CoA', 404),
  SYSTEM_ACCOUNT_PROTECTED: () =>
    new AppError('SYSTEM_ACCOUNT_PROTECTED', 'System accounts cannot be deleted or recoded', 409),
  CREDIT_NOTE_EXCEEDS_INVOICE: () =>
    new AppError('CREDIT_NOTE_EXCEEDS_INVOICE', 'Credit note total exceeds original invoice', 422),
  VALIDATION_ERROR: (msg: string, field?: string) =>
    new AppError('VALIDATION_ERROR', msg, 400, field),
  INTERNAL_ERROR: (msg = 'Unexpected server error') =>
    new AppError('INTERNAL_ERROR', msg, 500),
  ACCOUNT_LOCKED: () =>
    new AppError('ACCOUNT_LOCKED', 'Account is temporarily locked due to failed login attempts', 423),
  OUTBOUND_NOT_FOUND: () =>
    new AppError('OUTBOUND_NOT_FOUND', 'Outbound event does not exist', 404),
  OUTBOUND_ALREADY_FINALIZED: () =>
    new AppError('OUTBOUND_ALREADY_FINALIZED', 'Outbound event is already dispatched', 409),
  OUTBOUND_WEIGHT_REQUIRED: () =>
    new AppError('OUTBOUND_WEIGHT_REQUIRED', 'Outbound weight must be recorded before finalizing', 422),
  LOT_NOT_ACTIVE: () =>
    new AppError('LOT_NOT_ACTIVE', 'Lot must be ACTIVE to create a withdrawal', 409),
  INVOICE_NOT_FOUND: () => new AppError('INVOICE_NOT_FOUND', 'Invoice does not exist', 404),
  INVOICE_LINE_NOT_FOUND: () =>
    new AppError('INVOICE_LINE_NOT_FOUND', 'Invoice line does not exist', 404),
  INVOICE_LINE_IMMUTABLE: () =>
    new AppError(
      'INVOICE_LINE_IMMUTABLE',
      'STORAGE and ADVANCE_APPLIED lines cannot be edited',
      422,
    ),
  PAYMENT_NOT_FOUND: () => new AppError('PAYMENT_NOT_FOUND', 'Payment does not exist', 404),
  PAYMENT_OVER_ALLOCATED: () =>
    new AppError('PAYMENT_OVER_ALLOCATED', 'Total allocations exceed payment amount', 422),
  PAYMENT_EXCEEDS_INVOICE_BALANCE: () =>
    new AppError('PAYMENT_EXCEEDS_INVOICE_BALANCE', 'Allocation exceeds invoice balance due', 422),
  PAYMENT_PARTY_MISMATCH: () =>
    new AppError('PAYMENT_PARTY_MISMATCH', 'Invoice billing party does not match payment party', 422),
  PAYMENT_ALREADY_DISHONOURED: () =>
    new AppError('PAYMENT_ALREADY_DISHONOURED', 'Payment has already been dishonoured', 409),
  PAYMENT_NOT_CHEQUE: () =>
    new AppError('PAYMENT_NOT_CHEQUE', 'Only cheque payments can be dishonoured', 409),
  CREDIT_NOTE_NOT_FOUND: () =>
    new AppError('CREDIT_NOTE_NOT_FOUND', 'Credit note does not exist', 404),
  INVOICE_NOT_FINALIZED: () =>
    new AppError(
      'INVOICE_NOT_FINALIZED',
      'Operation requires a FINALIZED invoice',
      409,
    ),
  ACCOUNT_INACTIVE: () =>
    new AppError('ACCOUNT_INACTIVE', 'Account is inactive and cannot accept postings', 409),
  HEADER_ACCOUNT_NOT_POSTABLE: () =>
    new AppError(
      'HEADER_ACCOUNT_NOT_POSTABLE',
      'Cannot post journal entry lines to a HEADER account',
      422,
    ),
  PERIOD_ALREADY_LOCKED: () =>
    new AppError('PERIOD_ALREADY_LOCKED', 'Period is already locked', 409),
  PERIOD_NOT_LOCKED: () =>
    new AppError('PERIOD_NOT_LOCKED', 'Period is not currently locked', 409),
  // Phase 8B
  FIXED_ASSET_NOT_FOUND: () =>
    new AppError('FIXED_ASSET_NOT_FOUND', 'Fixed asset does not exist', 404),
  FIXED_ASSET_INVALID_STATUS: (msg: string) =>
    new AppError('FIXED_ASSET_INVALID_STATUS', msg, 409),
  DEPRECIATION_ALREADY_POSTED: () =>
    new AppError('DEPRECIATION_ALREADY_POSTED', 'Depreciation already posted for this period', 409),
  DEPRECIATION_NOTHING_TO_RUN: () =>
    new AppError('DEPRECIATION_NOTHING_TO_RUN', 'No assets eligible for depreciation in this period', 422),
  EMPLOYEE_NOT_FOUND: () => new AppError('EMPLOYEE_NOT_FOUND', 'Employee does not exist', 404),
  PAYROLL_RUN_NOT_FOUND: () => new AppError('PAYROLL_RUN_NOT_FOUND', 'Payroll run does not exist', 404),
  PAYROLL_RUN_INVALID_STATUS: (msg: string) =>
    new AppError('PAYROLL_RUN_INVALID_STATUS', msg, 409),
  PAYROLL_LINE_NOT_FOUND: () =>
    new AppError('PAYROLL_LINE_NOT_FOUND', 'Payroll line item does not exist', 404),
  PAYROLL_RUN_DUPLICATE_PERIOD: () =>
    new AppError('PAYROLL_RUN_DUPLICATE_PERIOD', 'A payroll run already exists for this period and type', 409),
  EXPENSE_VOUCHER_NOT_FOUND: () =>
    new AppError('EXPENSE_VOUCHER_NOT_FOUND', 'Expense voucher does not exist', 404),
  EXPENSE_VOUCHER_INVALID_STATUS: (msg: string) =>
    new AppError('EXPENSE_VOUCHER_INVALID_STATUS', msg, 409),
  PESHGI_NOT_FOUND: () => new AppError('PESHGI_NOT_FOUND', 'Peshgi loan does not exist', 404),
  PESHGI_OVER_REPAYMENT: () =>
    new AppError('PESHGI_OVER_REPAYMENT', 'Repayment amount exceeds outstanding loan balance', 422),
  PESHGI_INACTIVE: () =>
    new AppError('PESHGI_INACTIVE', 'Loan is fully recovered or written off; cannot record repayment', 409),
} as const;
