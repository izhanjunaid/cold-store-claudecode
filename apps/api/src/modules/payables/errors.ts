import { AppError } from '../../common/errors';

/** Payables errors, kept beside the module that raises them. */
export const PayablesErrors = {
  BILL_NOT_FOUND: () => new AppError('BILL_NOT_FOUND', 'Bill does not exist', 404),
  BILL_INVALID_STATUS: (msg: string) => new AppError('BILL_INVALID_STATUS', msg, 409),
  BILL_HAS_PAYMENTS: () =>
    new AppError('BILL_HAS_PAYMENTS', 'Payments are allocated to this bill; void those payments first', 409),
  BILL_NOT_PAYABLE: (msg: string) => new AppError('BILL_NOT_PAYABLE', msg, 422),
  BILL_OVER_ALLOCATED: (billNumber: string, open: number) =>
    new AppError('BILL_OVER_ALLOCATED', `Bill ${billNumber} has only ${open.toFixed(2)} left to pay`, 422),
  SUPPLIER_PAYMENT_NOT_FOUND: () => new AppError('SUPPLIER_PAYMENT_NOT_FOUND', 'Supplier payment does not exist', 404),
  SUPPLIER_PAYMENT_VOIDED: () =>
    new AppError('SUPPLIER_PAYMENT_VOIDED', 'This payment has been voided', 409),
};
