import { z } from 'zod';
import { InvoiceStatus, InvoiceLineType } from './enums';

// AddInvoiceLineRequest - add a line to a DRAFT invoice.
// A SERVICE line is a catalog entry: the server names and prices it from the service
// charge, and its revenue goes to that charge's account (docs/25 R-28). An ADJUSTMENT
// is any other charge (misc. service revenue); a reduction is the discount (R-07).
export const AddInvoiceLineRequest = z.discriminatedUnion('line_type', [
  z.object({
    line_type: z.literal('SERVICE'),
    service_charge_id: z.string().uuid(),
    /** Bags or tonnes for a per-bag / per-ton charge; a flat charge is always 1. */
    quantity: z.number().positive(),
  }),
  z.object({
    line_type: z.literal('ADJUSTMENT'),
    description: z.string().min(1).max(300),
    quantity: z.number().positive(),
    unit_price_pkr: z.number().positive(),
  }),
]);
export type AddInvoiceLineRequestType = z.infer<typeof AddInvoiceLineRequest>;

// UpdateDraftInvoiceRequest - edit the date, gst_rate or discount while the invoice is DRAFT
export const UpdateDraftInvoiceRequest = z.object({
  /** Defaults to the dispatch/transfer date; never before the billing period ends. */
  invoice_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  gst_rate: z.number().min(0).max(100).optional(),
  discount: z
    .object({
      type: z.enum(['PERCENT', 'FIXED']),
      value: z.number().positive(),
    })
    .nullable()
    .optional(), // null clears the discount; undefined leaves it unchanged
});
export type UpdateDraftInvoiceRequestType = z.infer<typeof UpdateDraftInvoiceRequest>;

// FinalizeInvoiceRequest
export const FinalizeInvoiceRequest = z.object({
  notes: z.string().optional(),
});
export type FinalizeInvoiceRequestType = z.infer<typeof FinalizeInvoiceRequest>;

// VoidInvoiceRequest — reverses a finalized, unpaid invoice's JE-01.
export const VoidInvoiceRequest = z.object({
  reason: z.string().min(1).max(400),
  void_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type VoidInvoiceRequestType = z.infer<typeof VoidInvoiceRequest>;

// InvoiceListQuery - for filtering the invoice list
export const InvoiceListQuery = z.object({
  party_id: z.string().uuid().optional(),
  lot_id: z.string().uuid().optional(),
  status: InvoiceStatus.optional(),
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});
export type InvoiceListQueryType = z.infer<typeof InvoiceListQuery>;

// InvoiceLineResponse
export const InvoiceLineResponse = z.object({
  id: z.string().uuid(),
  invoice_id: z.string().uuid(),
  line_type: InvoiceLineType,
  description: z.string(),
  quantity: z.number(),
  unit_price_pkr: z.number(),
  amount_pkr: z.number(),
  service_charge_id: z.string().uuid().nullable(),
  rate_plan_id: z.string().uuid().nullable(),
  sort_order: z.number().int(),
  created_at: z.string(),
});
export type InvoiceLineResponseType = z.infer<typeof InvoiceLineResponse>;

// InvoiceResponse
export const InvoiceResponse = z.object({
  id: z.string().uuid(),
  facility_id: z.string().uuid(),
  invoice_number: z.string().nullable(),
  lot_id: z.string().uuid(),
  lot_number: z.string(),
  outbound_event_id: z.string().uuid().nullable(),
  billing_party_id: z.string().uuid(),
  billing_party_name: z.string(),
  invoice_date: z.string(),
  period_start: z.string(),
  period_end: z.string(),
  sub_total_pkr: z.number(),
  discount_type: z.enum(['PERCENT', 'FIXED']).nullable(),
  discount_value: z.number().nullable(),
  discount_amount_pkr: z.number(),
  gst_rate: z.number(),
  gst_amount_pkr: z.number(),
  total_pkr: z.number(),
  /** Receipts allocated to the invoice. */
  amount_paid_pkr: z.number(),
  /** Standing credit notes against it. */
  amount_credited_pkr: z.number(),
  /** The bad-debt write-off, if any. */
  amount_written_off_pkr: z.number(),
  /** total − paid − credited − written off. */
  balance_due_pkr: z.number(),
  status: InvoiceStatus,
  finalized_at: z.string().nullable(),
  finalized_by: z.string().uuid().nullable(),
  book_type: z.enum(['PACCI', 'KATCHI']),
  notes: z.string().nullable(),
  voided_at: z.string().nullable(),
  void_reason: z.string().nullable(),
  created_at: z.string(),
  line_items: z.array(InvoiceLineResponse),
});
export type InvoiceResponseType = z.infer<typeof InvoiceResponse>;

// ============================================================
// Credit notes — built from the invoice's own lines (docs/25 R-03). They live
// here, beside the invoice they adjust; the older CreateCreditNoteRequest in
// accounting.ts (free revenue account, request book) is no longer read.
// ============================================================

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const IssueCreditNoteRequest = z.object({
  original_invoice_id: z.string().uuid(),
  credit_date: isoDate,
  reason: z.string().min(1),
  notes: z.string().optional(),
  line_items: z
    .array(
      z.object({
        /** The invoice line being credited; its revenue account is the one reversed. */
        invoice_line_item_id: z.string().uuid(),
        /** Revenue credited on that line, before its share of the discount and GST. */
        amount_pkr: z.number().positive(),
        description: z.string().min(1).max(300).optional(),
      }),
    )
    .min(1),
});
export type IssueCreditNoteRequestType = z.infer<typeof IssueCreditNoteRequest>;

export const CancelCreditNoteRequest = z.object({
  reason: z.string().min(1).max(400),
  /** Defaults to today; never before the credit note. */
  cancel_date: isoDate.optional(),
});
export type CancelCreditNoteRequestType = z.infer<typeof CancelCreditNoteRequest>;
