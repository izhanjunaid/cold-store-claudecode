import { z } from 'zod';
import { PaymentMethod, PaymentStatus, ClearanceStatus } from './enums';

// Discriminated allocation union — accepts either an invoice or a loan target.
// Legacy payloads `{invoice_id, allocated_amount_pkr}` are still accepted; the
// loan variant must explicitly set target='LOAN'.
const InvoiceAllocationLine = z.object({
  target: z.literal('INVOICE').optional().default('INVOICE'),
  invoice_id: z.string().uuid(),
  allocated_amount_pkr: z.number().positive(),
});

const LoanAllocationLine = z.object({
  target: z.literal('LOAN'),
  loan_id: z.string().uuid(),
  allocated_amount_pkr: z.number().positive(),
});

export const AllocationLine = z.union([LoanAllocationLine, InvoiceAllocationLine]);
export type AllocationLineType = z.infer<typeof AllocationLine>;

// CreatePaymentRequest
export const CreatePaymentRequest = z.object({
  party_id: z.string().uuid(),
  payment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount_pkr: z.number().positive(),
  payment_method: PaymentMethod,
  reference_number: z.string().max(100).optional(),
  is_advance: z.boolean().optional().default(false),
  cheque_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  book_type: z.enum(['PACCI', 'KATCHI']).optional().default('PACCI'),
  notes: z.string().optional(),
  allocations: z.array(AllocationLine).optional().default([]),
});
export type CreatePaymentRequestType = z.infer<typeof CreatePaymentRequest>;

// AllocatePaymentRequest — add allocations to an existing payment
export const AllocatePaymentRequest = z.object({
  allocations: z.array(AllocationLine).min(1),
});
export type AllocatePaymentRequestType = z.infer<typeof AllocatePaymentRequest>;

// DishonourPaymentRequest
export const DishonourPaymentRequest = z.object({
  notes: z.string().optional(),
});
export type DishonourPaymentRequestType = z.infer<typeof DishonourPaymentRequest>;

// PaymentListQuery
export const PaymentListQuery = z.object({
  party_id: z.string().uuid().optional(),
  status: PaymentStatus.optional(),
  payment_method: PaymentMethod.optional(),
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});
export type PaymentListQueryType = z.infer<typeof PaymentListQuery>;

// PaymentAllocationResponse
export const PaymentAllocationResponse = z.object({
  id: z.string().uuid(),
  payment_id: z.string().uuid(),
  target: z.enum(['INVOICE', 'LOAN']),
  invoice_id: z.string().uuid().nullable(),
  invoice_number: z.string().nullable(),
  loan_id: z.string().uuid().nullable(),
  loan_number: z.string().nullable(),
  allocated_amount_pkr: z.number(),
});
export type PaymentAllocationResponseType = z.infer<typeof PaymentAllocationResponse>;

// PaymentResponse
export const PaymentResponse = z.object({
  id: z.string().uuid(),
  facility_id: z.string().uuid(),
  party_id: z.string().uuid(),
  party_name: z.string(),
  payment_date: z.string(),
  amount_pkr: z.number(),
  payment_method: PaymentMethod,
  reference_number: z.string().nullable(),
  is_advance: z.boolean(),
  status: PaymentStatus,
  clearance_status: ClearanceStatus,
  cheque_date: z.string().nullable(),
  book_type: z.enum(['PACCI', 'KATCHI']),
  notes: z.string().nullable(),
  created_at: z.string(),
  created_by_name: z.string(),
  allocations: z.array(PaymentAllocationResponse),
});
export type PaymentResponseType = z.infer<typeof PaymentResponse>;

// PartyLedgerEntry
export const PartyLedgerEntry = z.object({
  date: z.string(),
  type: z.enum(['INVOICE', 'PAYMENT']),
  reference: z.string().nullable(),
  description: z.string(),
  debit_pkr: z.number(),
  credit_pkr: z.number(),
  balance_pkr: z.number(),
  id: z.string().uuid(),
});
export type PartyLedgerEntryType = z.infer<typeof PartyLedgerEntry>;

// PartyLedgerResponse
export const PartyLedgerResponse = z.object({
  party_id: z.string().uuid(),
  party_name: z.string(),
  entries: z.array(PartyLedgerEntry),
  total_debit_pkr: z.number(),
  total_credit_pkr: z.number(),
  closing_balance_pkr: z.number(),
});
export type PartyLedgerResponseType = z.infer<typeof PartyLedgerResponse>;
