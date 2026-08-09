import { z } from 'zod';

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

// =====================================================================
// Phase 10 â€” Reporting (M9) query schemas
// =====================================================================

export const DashboardReportQuery = z.object({});
export type DashboardReportQueryType = z.infer<typeof DashboardReportQuery>;

export const LotAgingReportQuery = z.object({
  date_from: dateOnly.optional(),
  date_to: dateOnly.optional(),
  party_id: z.string().uuid().optional(),
  chamber_id: z.string().uuid().optional(),
  commodity_id: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(500).default(50),
});
export type LotAgingReportQueryType = z.infer<typeof LotAgingReportQuery>;

export const ReceivablesAgingReportQuery = z.object({
  as_of_date: dateOnly.optional(),
  party_id: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(500).default(50),
});
export type ReceivablesAgingReportQueryType = z.infer<typeof ReceivablesAgingReportQuery>;

export const CommodityInventoryReportQuery = z.object({
  commodity_id: z.string().uuid().optional(),
  chamber_id: z.string().uuid().optional(),
});
export type CommodityInventoryReportQueryType = z.infer<typeof CommodityInventoryReportQuery>;

export const CashExceptionsReportQuery = z.object({
  as_of_date: dateOnly.optional(),
});
export type CashExceptionsReportQueryType = z.infer<typeof CashExceptionsReportQuery>;

export const WeightVarianceReportQuery = z.object({
  date_from: dateOnly.optional(),
  date_to: dateOnly.optional(),
  lot_id: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(500).default(50),
});
export type WeightVarianceReportQueryType = z.infer<typeof WeightVarianceReportQuery>;

export const SeasonalSummaryReportQuery = z.object({
  date_from: dateOnly,
  date_to: dateOnly,
  commodity_id: z.string().uuid().optional(),
});
export type SeasonalSummaryReportQueryType = z.infer<typeof SeasonalSummaryReportQuery>;

export const OwnershipTransfersReportQuery = z.object({
  date_from: dateOnly.optional(),
  date_to: dateOnly.optional(),
  party_id: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(500).default(50),
});
export type OwnershipTransfersReportQueryType = z.infer<typeof OwnershipTransfersReportQuery>;

export const PartyStatementQuery = z.object({
  date_from: dateOnly.optional(),
  date_to: dateOnly.optional(),
  book_type: z.enum(['PACCI', 'KATCHI']).default('PACCI'),
  format: z.enum(['json', 'pdf']).default('json'),
});
export type PartyStatementQueryType = z.infer<typeof PartyStatementQuery>;

// =====================================================================
// Response shapes
// =====================================================================

export const DashboardFinancialBlock = z.object({
  ar_total_pkr: z.number(),
  collected_today_pkr: z.number(),
  overdue_90_plus_pkr: z.number(),
});
export type DashboardFinancialBlockType = z.infer<typeof DashboardFinancialBlock>;

export const DashboardChamberRow = z.object({
  id: z.string().uuid(),
  name: z.string(),
  bags: z.number().int(),
  capacity: z.number().int(),
  occupancy_pct: z.number(),
});
export type DashboardChamberRowType = z.infer<typeof DashboardChamberRow>;

export const DashboardAttentionRow = z.object({
  lot_id: z.string().uuid(),
  lot_number: z.string(),
  owner_name: z.string(),
  commodity_name: z.string(),
  current_bags: z.number().int(),
  days_in_storage: z.number().int(),
  threshold: z.number().int(),
});
export type DashboardAttentionRowType = z.infer<typeof DashboardAttentionRow>;

export const DashboardUnbilledInvoiceRow = z.object({
  invoice_id: z.string().uuid(),
  lot_number: z.string(),
  billing_party_name: z.string(),
  total_pkr: z.number(),
  invoice_date: z.string(),
  source: z.enum(['DISPATCH', 'TRANSFER']),
});
export type DashboardUnbilledInvoiceRowType = z.infer<typeof DashboardUnbilledInvoiceRow>;

export const DashboardUnbilledInvoicesBlock = z.object({
  count: z.number().int(),
  total_pkr: z.number(),
  items: z.array(DashboardUnbilledInvoiceRow),
});
export type DashboardUnbilledInvoicesBlockType = z.infer<typeof DashboardUnbilledInvoicesBlock>;

export const DashboardResponse = z.object({
  active_lots: z.number().int(),
  total_bags: z.number().int(),
  occupancy_pct: z.number(),
  today_inbound_bags: z.number().int(),
  today_outbound_bags: z.number().int(),
  chambers: z.array(DashboardChamberRow),
  attention_required: z.array(DashboardAttentionRow),
  financial: DashboardFinancialBlock.nullable(),
  unbilled_invoices: DashboardUnbilledInvoicesBlock.nullable(),
});
export type DashboardResponseType = z.infer<typeof DashboardResponse>;

export const LotAgingRow = z.object({
  lot_id: z.string().uuid(),
  lot_number: z.string(),
  owner_name: z.string(),
  commodity_name: z.string(),
  chamber_name: z.string(),
  current_bags: z.number().int(),
  inbound_date: z.string(),
  days_in_storage: z.number().int(),
  threshold: z.number().int(),
  threshold_exceeded: z.boolean(),
});
export type LotAgingRowType = z.infer<typeof LotAgingRow>;

export const ReceivablesAgingBuckets = z.object({
  b_0_30: z.number(),
  b_31_60: z.number(),
  b_61_90: z.number(),
  b_90_plus: z.number(),
  total_pkr: z.number(),
});
export type ReceivablesAgingBucketsType = z.infer<typeof ReceivablesAgingBuckets>;

export const ReceivablesAgingPartyRow = z.object({
  party_id: z.string().uuid(),
  party_name: z.string(),
  party_type: z.string(),
  total_due_pkr: z.number(),
  b_0_30: z.number(),
  b_31_60: z.number(),
  b_61_90: z.number(),
  b_90_plus: z.number(),
  oldest_invoice_days: z.number().int(),
  // Unallocated on-account credit held for the party; net_due may go negative
  // when the party is in a credit position (phase/19 audit).
  unapplied_credit_pkr: z.number(),
  net_due_pkr: z.number(),
});
export type ReceivablesAgingPartyRowType = z.infer<typeof ReceivablesAgingPartyRow>;

export const ReceivablesAgingResponse = z.object({
  as_of_date: z.string(),
  buckets: ReceivablesAgingBuckets,
  total_unapplied_credit_pkr: z.number(),
  net_total_pkr: z.number(),
  // GL AR control total (1110/1120/1130/1150, POSTED, PACCI) and the variance
  // against net_total — surfaces divergence instead of assuming reconciliation.
  gl_ar_control_total_pkr: z.number(),
  variance_pkr: z.number(),
  reconciled: z.boolean(),
  parties: z.array(ReceivablesAgingPartyRow),
});
export type ReceivablesAgingResponseType = z.infer<typeof ReceivablesAgingResponse>;

export const CashExceptionsRow = z.object({
  account_code: z.string(),
  account_name: z.string(),
  is_active: z.boolean(),
  balance_pkr: z.number(),
  is_negative: z.boolean(),
});
export type CashExceptionsRowType = z.infer<typeof CashExceptionsRow>;

export const CashExceptionsResponse = z.object({
  as_of_date: z.string(),
  rows: z.array(CashExceptionsRow),
  has_exceptions: z.boolean(),
});
export type CashExceptionsResponseType = z.infer<typeof CashExceptionsResponse>;

export const CommodityInventoryPerChamber = z.object({
  chamber_id: z.string().uuid(),
  chamber_name: z.string(),
  bags: z.number().int(),
  occupancy_pct: z.number(),
});
export type CommodityInventoryPerChamberType = z.infer<typeof CommodityInventoryPerChamber>;

export const CommodityInventoryRow = z.object({
  commodity_id: z.string().uuid(),
  commodity_name: z.string(),
  total_bags: z.number().int(),
  per_chamber: z.array(CommodityInventoryPerChamber),
});
export type CommodityInventoryRowType = z.infer<typeof CommodityInventoryRow>;

export const WeightVarianceRow = z.object({
  lot_id: z.string().uuid(),
  lot_number: z.string(),
  owner_name: z.string(),
  inbound_kg_prorated: z.number(),
  outbound_kg_total: z.number(),
  variance_kg: z.number(),
  variance_pct: z.number(),
  finalized_outbound_count: z.number().int(),
});
export type WeightVarianceRowType = z.infer<typeof WeightVarianceRow>;

export const SeasonalSummaryCommodityRow = z.object({
  commodity_id: z.string().uuid(),
  commodity_name: z.string(),
  inbound_bags: z.number().int(),
  outbound_bags: z.number().int(),
  revenue_pkr: z.number(),
});
export type SeasonalSummaryCommodityRowType = z.infer<typeof SeasonalSummaryCommodityRow>;

export const SeasonalSummaryResponse = z.object({
  period: z.object({ from: z.string(), to: z.string() }),
  total_inbound_bags: z.number().int(),
  total_outbound_bags: z.number().int(),
  total_revenue_pkr: z.number(),
  avg_storage_days: z.number().nullable(),
  commodities: z.array(SeasonalSummaryCommodityRow),
});
export type SeasonalSummaryResponseType = z.infer<typeof SeasonalSummaryResponse>;

export const OwnershipTransferRow = z.object({
  transfer_id: z.string().uuid(),
  lot_id: z.string().uuid(),
  lot_number: z.string(),
  child_lot_id: z.string().uuid().nullable(),
  child_lot_number: z.string().nullable(),
  from_party_id: z.string().uuid().nullable(),
  from_party_name: z.string().nullable(),
  to_party_id: z.string().uuid(),
  to_party_name: z.string(),
  quantity_bags: z.number().int(),
  transfer_price_pkr: z.number().nullable(),
  transfer_date: z.string(),
  type: z.enum(['FULL', 'PARTIAL']),
  operator_id: z.string().uuid(),
  notes: z.string().nullable(),
});
export type OwnershipTransferRowType = z.infer<typeof OwnershipTransferRow>;

export const PartyStatementEntry = z.object({
  id: z.string().uuid(),
  date: z.string(),
  type: z.enum(['OPENING_BALANCE', 'INVOICE', 'PAYMENT', 'CREDIT_NOTE', 'SURCHARGE']),
  reference: z.string().nullable(),
  description: z.string(),
  debit_pkr: z.number(),
  credit_pkr: z.number(),
  balance_pkr: z.number(),
});
export type PartyStatementEntryType = z.infer<typeof PartyStatementEntry>;

export const PartyStatementResponse = z.object({
  party_id: z.string().uuid(),
  party_name: z.string(),
  party_type: z.string(),
  book_type: z.enum(['PACCI', 'KATCHI']),
  date_from: z.string().nullable(),
  date_to: z.string().nullable(),
  opening_balance_pkr: z.number(),
  entries: z.array(PartyStatementEntry),
  total_debit_pkr: z.number(),
  total_credit_pkr: z.number(),
  closing_balance_pkr: z.number(),
});
export type PartyStatementResponseType = z.infer<typeof PartyStatementResponse>;
