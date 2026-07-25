import { z } from 'zod';

// CreateInvoiceRequest - for manually creating invoices (optional, auto-creation is via outbound finalize)
export const CreateInvoiceRequest = z.object({
  lot_id: z.string().uuid(),
  outbound_event_id: z.string().uuid().optional(),
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  invoice_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  gst_rate: z.number().min(0).max(100).optional(),
  notes: z.string().optional(),
});
export type CreateInvoiceRequestType = z.infer<typeof CreateInvoiceRequest>;

// AddInvoiceLineRequest - add SERVICE or ADJUSTMENT line to a DRAFT invoice
export const AddInvoiceLineRequest = z.object({
  line_type: z.enum(['SERVICE', 'ADJUSTMENT']),
  description: z.string().min(1).max(300),
  quantity: z.number().positive(),
  unit_price_pkr: z.number(), // can be negative for ADJUSTMENT
  service_charge_id: z.string().uuid().optional(),
});
export type AddInvoiceLineRequestType = z.infer<typeof AddInvoiceLineRequest>;

// UpdateDraftInvoiceRequest - edit gst_rate / discount while invoice is DRAFT
export const UpdateDraftInvoiceRequest = z.object({
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
  status: z.enum(['DRAFT', 'FINALIZED', 'VOID']).optional(),
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
  line_type: z.enum(['STORAGE', 'SERVICE', 'ADJUSTMENT', 'ADVANCE_APPLIED']),
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
  amount_paid_pkr: z.number(),
  balance_due_pkr: z.number(), // computed: total_pkr - amount_paid_pkr
  status: z.enum(['DRAFT', 'FINALIZED', 'VOID']),
  finalized_at: z.string().nullable(),
  finalized_by: z.string().uuid().nullable(),
  book_type: z.enum(['PACCI', 'KATCHI']),
  notes: z.string().nullable(),
  created_at: z.string(),
  line_items: z.array(InvoiceLineResponse),
});
export type InvoiceResponseType = z.infer<typeof InvoiceResponse>;
