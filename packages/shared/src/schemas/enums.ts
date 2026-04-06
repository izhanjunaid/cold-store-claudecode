import { z } from 'zod';

export const UserRole = z.enum([
  'OWNER',
  'MANAGER',
  'ACCOUNTANT',
  'OPERATOR',
  'SECURITY',
  'VIEWER',
]);
export type UserRole = z.infer<typeof UserRole>;

export const PartyType = z.enum(['FARMER', 'TRADER', 'ARHTI', 'BUYER', 'OTHER']);
export type PartyType = z.infer<typeof PartyType>;

export const BookType = z.enum(['PACCI', 'KATCHI']);
export type BookType = z.infer<typeof BookType>;

export const LotStatus = z.enum(['ACTIVE', 'CLOSED', 'SUSPENDED']);
export type LotStatus = z.infer<typeof LotStatus>;

export const RateType = z.enum(['SEASONAL_PER_BAG', 'MONTHLY_PER_BAG', 'DAILY_PER_BAG']);
export type RateType = z.infer<typeof RateType>;

export const ServiceUnitType = z.enum(['PER_BAG', 'PER_TON', 'FLAT']);
export type ServiceUnitType = z.infer<typeof ServiceUnitType>;

export const WithdrawalType = z.enum(['FULL', 'PARTIAL']);
export type WithdrawalType = z.infer<typeof WithdrawalType>;

export const OutboundStatus = z.enum([
  'PENDING',
  'WEIGHED',
  'DISPATCHED',
  'CANCELLED',
  'DISPUTED',
]);
export type OutboundStatus = z.infer<typeof OutboundStatus>;

export const InvoiceStatus = z.enum([
  'DRAFT',
  'PREVIEW',
  'FINALIZED',
  'PAID',
  'DISPUTED',
  'CANCELLED',
  'OUTSTANDING',
  'WRITTEN_OFF',
]);
export type InvoiceStatus = z.infer<typeof InvoiceStatus>;

export const InvoiceLineType = z.enum(['STORAGE', 'SERVICE', 'ADJUSTMENT', 'ADVANCE_APPLIED']);
export type InvoiceLineType = z.infer<typeof InvoiceLineType>;

export const PaymentMethod = z.enum(['CASH', 'CHEQUE', 'BANK_TRANSFER', 'MOBILE_WALLET']);
export type PaymentMethod = z.infer<typeof PaymentMethod>;

export const PaymentStatus = z.enum(['RECORDED', 'ALLOCATED', 'ADVANCE', 'DISHONOURED']);
export type PaymentStatus = z.infer<typeof PaymentStatus>;

export const ClearanceStatus = z.enum(['NA', 'PENDING', 'CLEARED', 'BOUNCED']);
export type ClearanceStatus = z.infer<typeof ClearanceStatus>;

export const SpoilageCause = z.enum([
  'TEMPERATURE_FAILURE',
  'NATURAL_DECAY',
  'HANDLING',
  'PEST',
  'OTHER',
]);
export type SpoilageCause = z.infer<typeof SpoilageCause>;

export const SpoilageStatus = z.enum(['PENDING_REVIEW', 'CONFIRMED', 'DISPUTED', 'DISMISSED']);
export type SpoilageStatus = z.infer<typeof SpoilageStatus>;

export const OwnershipEventType = z.enum(['INITIAL', 'TRANSFER_IN', 'TRANSFER_OUT']);
export type OwnershipEventType = z.infer<typeof OwnershipEventType>;

export const GatePassDirection = z.enum(['INWARD', 'OUTWARD']);
export type GatePassDirection = z.infer<typeof GatePassDirection>;

export const GatePassStatus = z.enum(['ARRIVED', 'WEIGHING', 'CLEARED', 'CANCELLED']);
export type GatePassStatus = z.infer<typeof GatePassStatus>;

export const LoanStatus = z.enum(['ACTIVE', 'RECOVERED', 'WRITTEN_OFF']);
export type LoanStatus = z.infer<typeof LoanStatus>;

export const LoanRepaymentMethod = z.enum(['CASH', 'BANK_TRANSFER', 'DEDUCTED_FROM_PRODUCE']);
export type LoanRepaymentMethod = z.infer<typeof LoanRepaymentMethod>;

export const AccountClass = z.enum([
  'ASSET',
  'LIABILITY',
  'EQUITY',
  'REVENUE',
  'COST_OF_SERVICE',
  'EXPENSE',
]);
export type AccountClass = z.infer<typeof AccountClass>;

export const AccountType = z.enum(['HEADER', 'DETAIL']);
export type AccountType = z.infer<typeof AccountType>;

export const NormalBalance = z.enum(['DEBIT', 'CREDIT']);
export type NormalBalance = z.infer<typeof NormalBalance>;

export const JournalEntryType = z.enum([
  'INVOICE',
  'PAYMENT',
  'ADVANCE',
  'CREDIT_NOTE',
  'ADJUSTMENT',
  'ACCRUAL',
  'BAD_DEBT',
  'REVERSAL',
  'DEPRECIATION',
  'PAYROLL',
  'EXPENSE',
  'ASSET_PURCHASE',
  'ASSET_DISPOSAL',
  'PESHGI_ISSUE',
  'PESHGI_RECOVERY',
  'DAMAGE_LIABILITY',
]);
export type JournalEntryType = z.infer<typeof JournalEntryType>;

export const PostingStatus = z.enum(['AUTO_DRAFT', 'POSTED', 'REVERSED']);
export type PostingStatus = z.infer<typeof PostingStatus>;

export const AuditAction = z.enum(['INSERT', 'UPDATE']);
export type AuditAction = z.infer<typeof AuditAction>;

export const TemperatureSource = z.enum(['MANUAL', 'SENSOR']);
export type TemperatureSource = z.infer<typeof TemperatureSource>;
