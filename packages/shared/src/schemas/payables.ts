import { z } from 'zod';
import { BookType, PaymentMethod } from './enums';
import { WithholdingSection } from './expenses';

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

/** Void a posted payables / treasury document: its entry is reversed, the row stays. */
export const VoidDocumentRequest = z.object({
  reason: z.string().trim().min(3).max(400),
  /** Defaults to today; may not precede the document's own date. */
  void_date: dateOnly.optional(),
});
export type VoidDocumentRequestType = z.infer<typeof VoidDocumentRequest>;

// ============================================================
// Cash transfers (docs/25 C-44) — the create request is CreateCashTransferRequest
// ============================================================

export const CashTransferListQuery = z.object({
  book_type: BookType.optional(),
  date_from: dateOnly.optional(),
  date_to: dateOnly.optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(50),
});
export type CashTransferListQueryType = z.infer<typeof CashTransferListQuery>;

export const CashTransferAction = z.enum(['void']);
export type CashTransferActionType = z.infer<typeof CashTransferAction>;

// ============================================================
// Bills and supplier payments (docs/25 Q3 — full payables)
// ============================================================

/** A cost line on a bill. The account is checked against the chart server-side (C-05). */
export const BillLineInput = z.object({
  expense_account_code: z.string().regex(/^[0-9]+$/),
  description: z.string().trim().min(1).max(300),
  amount_pkr: z.number().positive(),
});
export type BillLineInputType = z.infer<typeof BillLineInput>;

export const BillRequest = z
  .object({
    supplier_party_id: z.string().uuid(),
    bill_date: dateOnly,
    due_date: dateOnly.nullable().optional(),
    supplier_reference: z.string().trim().max(100).nullable().optional(),
    description: z.string().trim().min(1).max(500),
    lines: z.array(BillLineInput).min(1).max(50),
    /** Sales tax the supplier charged that the facility can adjust (1260). Official book only. */
    input_tax_pkr: z.number().nonnegative().default(0),
    book_type: BookType.optional().default('PACCI'),
    notes: z.string().max(2000).nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.due_date && v.due_date < v.bill_date) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['due_date'], message: 'A bill cannot fall due before its date.' });
    }
  });
export type BillRequestType = z.infer<typeof BillRequest>;

export const BillStatus = z.enum(['DRAFT', 'POSTED', 'VOID']);
export const BillPaymentStatus = z.enum(['UNPAID', 'PARTIAL', 'PAID']);
export const BillAction = z.enum(['edit', 'delete', 'post', 'pay', 'void']);
export type BillActionType = z.infer<typeof BillAction>;

export const BillListQuery = z.object({
  supplier_party_id: z.string().uuid().optional(),
  status: BillStatus.optional(),
  book_type: BookType.optional(),
  date_from: dateOnly.optional(),
  date_to: dateOnly.optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});
export type BillListQueryType = z.infer<typeof BillListQuery>;

export const AllocationInput = z.object({
  bill_id: z.string().uuid(),
  amount_pkr: z.number().positive(),
});
export type AllocationInputType = z.infer<typeof AllocationInput>;

/**
 * How a supplier is paid. One method enum for every payment the facility makes or
 * receives (C-12); the paid-from account defaults from it and must be a cash
 * equivalent. The tax withheld is the rate applied to the gross, computed by the
 * server; the supplier receives the rest.
 */
const SupplierPaymentFields = {
  payment_date: dateOnly,
  payment_method: PaymentMethod,
  asset_account_code: z.string().regex(/^[0-9]+$/).optional(),
  withholding_section: WithholdingSection.optional(),
  withholding_rate_pct: z.number().positive().max(50).optional(),
  certificate_number: z.string().trim().max(50).nullable().optional(),
  reference_number: z.string().trim().max(100).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
};

function requireSectionWithRate(v: { withholding_section?: string; withholding_rate_pct?: number }, ctx: z.RefinementCtx) {
  if (!!v.withholding_section !== !!v.withholding_rate_pct) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['withholding_rate_pct'],
      message: 'Give both the section and the rate the tax was withheld under — s.153 and s.155 are reported separately.',
    });
  }
}

export const CreateSupplierPaymentRequest = z
  .object({
    ...SupplierPaymentFields,
    supplier_party_id: z.string().uuid(),
    gross_amount_pkr: z.number().positive(),
    book_type: BookType.optional().default('PACCI'),
    allocations: z.array(AllocationInput).max(50).default([]),
  })
  .superRefine(requireSectionWithRate);
export type CreateSupplierPaymentRequestType = z.infer<typeof CreateSupplierPaymentRequest>;

/** "Pay now": the bill is posted and paid in full in one action. */
export const PostBillRequest = z.object({
  pay_now: z.object(SupplierPaymentFields).superRefine(requireSectionWithRate).optional(),
});
export type PostBillRequestType = z.infer<typeof PostBillRequest>;

export const AllocateSupplierPaymentRequest = z.object({
  allocations: z.array(AllocationInput).min(1).max(50),
});
export type AllocateSupplierPaymentRequestType = z.infer<typeof AllocateSupplierPaymentRequest>;

export const SupplierPaymentAction = z.enum(['allocate', 'void']);
export type SupplierPaymentActionType = z.infer<typeof SupplierPaymentAction>;

export const SupplierPaymentListQuery = z.object({
  supplier_party_id: z.string().uuid().optional(),
  book_type: BookType.optional(),
  date_from: dateOnly.optional(),
  date_to: dateOnly.optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});
export type SupplierPaymentListQueryType = z.infer<typeof SupplierPaymentListQuery>;

export const PayablesAgingQuery = z.object({ book_type: BookType.optional() });

export const SupplierStatementQuery = z.object({
  book_type: BookType.optional(),
  date_from: dateOnly.optional(),
  date_to: dateOnly.optional(),
});
export type SupplierStatementQueryType = z.infer<typeof SupplierStatementQuery>;

// ============================================================
// Statutory remittances (docs/25 C-10) — EOBI, s.149, s.153, s.155 by period
// ============================================================

export const CreateTaxRemittanceRequest = z.object({
  liability_account_code: z.string().regex(/^[0-9]+$/),
  period_year: z.number().int().min(2000).max(2100),
  period_month: z.number().int().min(1).max(12),
  /** When the money leaves — on or after the period end. */
  remittance_date: dateOnly,
  paid_from_account_code: z.string().regex(/^[0-9]+$/),
  /** The FBR / EOBI computerised payment receipt (CPR / challan) number. */
  challan_number: z.string().trim().max(50).nullable().optional(),
  book_type: BookType.optional().default('PACCI'),
  notes: z.string().max(2000).nullable().optional(),
});
export type CreateTaxRemittanceRequestType = z.infer<typeof CreateTaxRemittanceRequest>;

export const TaxRemittanceOutstandingQuery = z.object({
  period_year: z.coerce.number().int().min(2000).max(2100),
  period_month: z.coerce.number().int().min(1).max(12),
  book_type: BookType.optional(),
});
export type TaxRemittanceOutstandingQueryType = z.infer<typeof TaxRemittanceOutstandingQuery>;

export const TaxRemittanceListQuery = z.object({
  period_year: z.coerce.number().int().min(2000).max(2100).optional(),
  book_type: BookType.optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(50),
});
export type TaxRemittanceListQueryType = z.infer<typeof TaxRemittanceListQuery>;

export const TaxRemittanceAction = z.enum(['void']);
export type TaxRemittanceActionType = z.infer<typeof TaxRemittanceAction>;
