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
} as const;
