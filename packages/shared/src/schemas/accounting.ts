import { z } from 'zod';
import {
  AccountClass,
  AccountType,
  NormalBalance,
  JournalEntryType,
  PostingStatus,
  BookType,
  CreditNoteStatus,
} from './enums';

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

// ============================================================
// Chart of Accounts
// ============================================================

export const ChartOfAccountsResponse = z.object({
  id: z.string().uuid(),
  facility_id: z.string().uuid(),
  account_code: z.string(),
  account_name: z.string(),
  account_class: AccountClass,
  account_type: AccountType,
  parent_account_code: z.string().nullable(),
  normal_balance: NormalBalance,
  is_system_account: z.boolean(),
  is_active: z.boolean(),
  created_at: z.string(),
});
export type ChartOfAccountsResponseType = z.infer<typeof ChartOfAccountsResponse>;

export const CreateAccountRequest = z.object({
  account_code: z.string().min(2).max(10).regex(/^[0-9]+$/),
  account_name: z.string().min(1).max(200),
  account_class: AccountClass,
  account_type: AccountType,
  parent_account_code: z.string().max(10).nullable().optional(),
  normal_balance: NormalBalance,
});
export type CreateAccountRequestType = z.infer<typeof CreateAccountRequest>;

export const UpdateAccountRequest = z.object({
  account_name: z.string().min(1).max(200).optional(),
  is_active: z.boolean().optional(),
});
export type UpdateAccountRequestType = z.infer<typeof UpdateAccountRequest>;

export const ChartOfAccountsListQuery = z.object({
  account_class: AccountClass.optional(),
  is_active: z.coerce.boolean().optional(),
});
export type ChartOfAccountsListQueryType = z.infer<typeof ChartOfAccountsListQuery>;

// ============================================================
// Journal Entries
// ============================================================

export const JournalEntryLineResponse = z.object({
  id: z.string().uuid(),
  line_number: z.number().int(),
  account_code: z.string(),
  account_name: z.string().optional(),
  debit_amount: z.number(),
  credit_amount: z.number(),
  party_id: z.string().uuid().nullable(),
  party_name: z.string().nullable(),
  lot_id: z.string().uuid().nullable(),
  lot_number: z.string().nullable(),
  description: z.string().nullable(),
});
export type JournalEntryLineResponseType = z.infer<typeof JournalEntryLineResponse>;

export const JournalEntryResponse = z.object({
  id: z.string().uuid(),
  facility_id: z.string().uuid(),
  entry_number: z.string(),
  entry_date: z.string(),
  entry_type: JournalEntryType,
  book_type: BookType,
  source_table: z.string(),
  source_id: z.string().uuid(),
  description: z.string(),
  posting_status: PostingStatus,
  period_month: z.number().int(),
  period_year: z.number().int(),
  reversed_by_id: z.string().uuid().nullable(),
  reversed_by_entry_number: z.string().nullable(),
  total_debit_pkr: z.number(),
  total_credit_pkr: z.number(),
  created_at: z.string(),
  created_by_name: z.string(),
  lines: z.array(JournalEntryLineResponse),
});
export type JournalEntryResponseType = z.infer<typeof JournalEntryResponse>;

export const JournalEntryListQuery = z.object({
  entry_type: JournalEntryType.optional(),
  book_type: BookType.optional(),
  source_table: z.string().optional(),
  source_id: z.string().uuid().optional(),
  date_from: dateOnly.optional(),
  date_to: dateOnly.optional(),
  posting_status: PostingStatus.optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});
export type JournalEntryListQueryType = z.infer<typeof JournalEntryListQuery>;

export const CreateManualJournalEntryRequest = z.object({
  entry_date: dateOnly,
  description: z.string().min(1).max(500),
  book_type: BookType.optional().default('PACCI'),
  // Default to POSTED: the web form posts by default and F-7's intent is that
  // leaving an entry as a draft is an explicit choice, not a silent one that
  // vanishes from every report (phase/19 audit item 12).
  posting_status: z.enum(['AUTO_DRAFT', 'POSTED']).optional().default('POSTED'),
  lines: z
    .array(
      z.object({
        account_code: z.string(),
        debit_amount: z.number().min(0),
        credit_amount: z.number().min(0),
        party_id: z.string().uuid().optional(),
        lot_id: z.string().uuid().optional(),
        description: z.string().max(300).optional(),
      }),
    )
    .min(2),
});
export type CreateManualJournalEntryRequestType = z.infer<typeof CreateManualJournalEntryRequest>;

export const ReverseJournalEntryRequest = z.object({
  reason: z.string().min(1).max(400),
  // Defaults to today; must land in an open period either way.
  entry_date: dateOnly.optional(),
});
export type ReverseJournalEntryRequestType = z.infer<typeof ReverseJournalEntryRequest>;

// ============================================================
// Opening Balances (Gap 1)
// ============================================================

export const EnterOpeningBalancesRequest = z.object({
  as_of_date: dateOnly,
  party_receivables: z
    .array(
      z.object({
        party_id: z.string().uuid(),
        amount_pkr: z.number().positive(),
      }),
    )
    .optional()
    .default([]),
  cash_pkr: z.number().min(0).optional().default(0),
  bank_pkr: z.number().min(0).optional().default(0),
  other_lines: z
    .array(
      z.object({
        account_code: z.string(),
        debit_pkr: z.number().min(0).optional().default(0),
        credit_pkr: z.number().min(0).optional().default(0),
        description: z.string().max(300).optional(),
      }),
    )
    .optional()
    .default([]),
});
export type EnterOpeningBalancesRequestType = z.infer<typeof EnterOpeningBalancesRequest>;

export const OpeningBalanceStatusResponse = z.object({
  entered: z.boolean(),
  journal_entry_id: z.string().uuid().nullable(),
  entry_number: z.string().nullable(),
  as_of_date: z.string().nullable(),
});
export type OpeningBalanceStatusResponseType = z.infer<typeof OpeningBalanceStatusResponse>;

// ============================================================
// General Ledger
// ============================================================

export const GeneralLedgerEntry = z.object({
  date: z.string(),
  entry_number: z.string(),
  entry_id: z.string().uuid(),
  description: z.string(),
  party_name: z.string().nullable(),
  lot_number: z.string().nullable(),
  debit_pkr: z.number(),
  credit_pkr: z.number(),
  balance_pkr: z.number(),
});
export type GeneralLedgerEntryType = z.infer<typeof GeneralLedgerEntry>;

export const GeneralLedgerResponse = z.object({
  account_code: z.string(),
  account_name: z.string(),
  account_class: AccountClass,
  normal_balance: NormalBalance,
  date_from: z.string().nullable(),
  date_to: z.string().nullable(),
  opening_balance_pkr: z.number(),
  total_debit_pkr: z.number(),
  total_credit_pkr: z.number(),
  closing_balance_pkr: z.number(),
  entries: z.array(GeneralLedgerEntry),
});
export type GeneralLedgerResponseType = z.infer<typeof GeneralLedgerResponse>;

export const GeneralLedgerQuery = z.object({
  account_code: z.string().regex(/^[0-9]+$/),
  date_from: dateOnly.optional(),
  date_to: dateOnly.optional(),
  party_id: z.string().uuid().optional(),
  book_type: BookType.optional(),
});
export type GeneralLedgerQueryType = z.infer<typeof GeneralLedgerQuery>;

// ============================================================
// Trial Balance
// ============================================================

export const TrialBalanceRow = z.object({
  account_code: z.string(),
  account_name: z.string(),
  account_class: AccountClass,
  normal_balance: NormalBalance,
  opening_debit_pkr: z.number(),
  opening_credit_pkr: z.number(),
  movement_debit_pkr: z.number(),
  movement_credit_pkr: z.number(),
  debit_balance_pkr: z.number(),
  credit_balance_pkr: z.number(),
});
export type TrialBalanceRowType = z.infer<typeof TrialBalanceRow>;

export const TrialBalanceGroup = z.object({
  account_class: AccountClass,
  label: z.string(),
  rows: z.array(TrialBalanceRow),
  subtotal: z.object({
    opening_debit_pkr: z.number(),
    opening_credit_pkr: z.number(),
    movement_debit_pkr: z.number(),
    movement_credit_pkr: z.number(),
    debit_balance_pkr: z.number(),
    credit_balance_pkr: z.number(),
  }),
});
export type TrialBalanceGroupType = z.infer<typeof TrialBalanceGroup>;

export const TrialBalanceResponse = z.object({
  date_from: z.string().nullable(),
  date_to: z.string(),
  groups: z.array(TrialBalanceGroup),
  rows: z.array(TrialBalanceRow),
  total_opening_debit_pkr: z.number(),
  total_opening_credit_pkr: z.number(),
  total_movement_debit_pkr: z.number(),
  total_movement_credit_pkr: z.number(),
  total_debit_pkr: z.number(),
  total_credit_pkr: z.number(),
  is_balanced: z.boolean(),
});
export type TrialBalanceResponseType = z.infer<typeof TrialBalanceResponse>;

export const TrialBalanceQuery = z.object({
  date_from: dateOnly.optional(),
  date_to: dateOnly.optional(),
  book_type: BookType.optional(),
});
export type TrialBalanceQueryType = z.infer<typeof TrialBalanceQuery>;

// ============================================================
// P&L and Balance Sheet
// ============================================================

export const StatementLine = z.object({
  account_code: z.string(),
  account_name: z.string(),
  amount_pkr: z.number(),
});
export type StatementLineType = z.infer<typeof StatementLine>;

export const StatementGroup = z.object({
  code: z.string(),
  name: z.string(),
  lines: z.array(StatementLine),
  subtotal_pkr: z.number(),
});
export type StatementGroupType = z.infer<typeof StatementGroup>;

export const ProfitLossResponse = z.object({
  date_from: z.string(),
  date_to: z.string(),

  revenue_groups: z.array(StatementGroup),
  total_operating_revenue_pkr: z.number(),
  contra_revenue_lines: z.array(StatementLine),
  total_contra_revenue_pkr: z.number(),
  net_revenue_pkr: z.number(),

  cost_of_service_lines: z.array(StatementLine),
  total_cost_of_service_pkr: z.number(),
  gross_profit_pkr: z.number(),
  // Margins are null when net revenue is zero/negative — undefined, not 0%.
  gross_profit_pct: z.number().nullable(),

  operating_expense_lines: z.array(StatementLine),
  total_operating_expense_pkr: z.number(),
  operating_profit_pkr: z.number(),
  operating_profit_pct: z.number().nullable(),

  other_income_lines: z.array(StatementLine),
  total_other_income_pkr: z.number(),

  depreciation_amortisation_pkr: z.number(),
  ebitda_pkr: z.number(),
  ebitda_pct: z.number().nullable(),

  net_profit_pkr: z.number(),
  net_profit_pct: z.number().nullable(),

  // Activity in accounts the header rollups could not place (F-6b);
  // amounts are signed as their contribution to net profit.
  unclassified_lines: z.array(StatementLine),
  total_unclassified_pkr: z.number(),
  has_unclassified: z.boolean(),

  // Back-compat flat fields
  revenue_lines: z.array(StatementLine),
  total_revenue_pkr: z.number(),
  expense_lines: z.array(StatementLine),
  total_expense_pkr: z.number(),
});
export type ProfitLossResponseType = z.infer<typeof ProfitLossResponse>;

export const ProfitLossQuery = z.object({
  date_from: dateOnly,
  date_to: dateOnly,
  book_type: BookType.optional(),
});
export type ProfitLossQueryType = z.infer<typeof ProfitLossQuery>;

export const BalanceSheetResponse = z.object({
  as_of_date: z.string(),

  current_asset_groups: z.array(StatementGroup),
  total_current_assets_pkr: z.number(),
  non_current_asset_groups: z.array(StatementGroup),
  total_non_current_assets_pkr: z.number(),
  total_assets_pkr: z.number(),

  current_liability_groups: z.array(StatementGroup),
  total_current_liabilities_pkr: z.number(),
  non_current_liability_groups: z.array(StatementGroup),
  total_non_current_liabilities_pkr: z.number(),
  total_liabilities_pkr: z.number(),

  equity_lines: z.array(StatementLine),
  // Retained earnings = posted 3020 + accumulated prior fiscal-year results;
  // current_year_pl covers only the fiscal year containing as_of_date (virtual
  // closing). fiscal_year_start is that FY's first day (ISO date).
  retained_earnings_pkr: z.number(),
  prior_years_pl_pkr: z.number(),
  current_year_pl_pkr: z.number(),
  fiscal_year_start: z.string(),
  total_equity_pkr: z.number(),
  total_liabilities_and_equity_pkr: z.number(),

  // Balances the header rollups could not place (F-6b).
  unclassified_asset_lines: z.array(StatementLine),
  unclassified_liability_lines: z.array(StatementLine),
  has_unclassified: z.boolean(),

  is_balanced: z.boolean(),

  // Back-compat flat fields
  asset_lines: z.array(StatementLine),
  liability_lines: z.array(StatementLine),
});
export type BalanceSheetResponseType = z.infer<typeof BalanceSheetResponse>;

export const BalanceSheetQuery = z.object({
  as_of_date: dateOnly,
  book_type: BookType.optional(),
});
export type BalanceSheetQueryType = z.infer<typeof BalanceSheetQuery>;

// ============================================================
// Period Lock
// ============================================================

export const PeriodLockResponse = z.object({
  id: z.string().uuid(),
  facility_id: z.string().uuid(),
  period_year: z.number().int(),
  period_month: z.number().int(),
  locked_at: z.string(),
  locked_by_name: z.string(),
  unlocked_at: z.string().nullable(),
  unlocked_by_name: z.string().nullable(),
  reason: z.string().nullable(),
  is_locked: z.boolean(),
});
export type PeriodLockResponseType = z.infer<typeof PeriodLockResponse>;

export const LockPeriodRequest = z.object({
  period_year: z.number().int().min(2000).max(2100),
  period_month: z.number().int().min(1).max(12),
  reason: z.string().optional(),
});
export type LockPeriodRequestType = z.infer<typeof LockPeriodRequest>;

export const UnlockPeriodRequest = z.object({
  reason: z.string().min(1),
});
export type UnlockPeriodRequestType = z.infer<typeof UnlockPeriodRequest>;

// ============================================================
// Credit Notes
// ============================================================

export const CreateCreditNoteRequest = z.object({
  original_invoice_id: z.string().uuid(),
  credit_date: dateOnly,
  reason: z.string().min(1),
  line_items: z
    .array(
      z.object({
        revenue_account_code: z.string().regex(/^4[0-9]+$/, 'Must be a revenue account (4XXX)'),
        description: z.string().min(1).max(300),
        amount_pkr: z.number().positive(),
      }),
    )
    .min(1),
  book_type: BookType.optional().default('PACCI'),
  notes: z.string().optional(),
});
export type CreateCreditNoteRequestType = z.infer<typeof CreateCreditNoteRequest>;

export const CreditNoteLineItemResponse = z.object({
  id: z.string().uuid(),
  revenue_account_code: z.string(),
  description: z.string(),
  amount_pkr: z.number(),
  sort_order: z.number().int(),
});
export type CreditNoteLineItemResponseType = z.infer<typeof CreditNoteLineItemResponse>;

export const CreditNoteResponse = z.object({
  id: z.string().uuid(),
  facility_id: z.string().uuid(),
  credit_note_number: z.string().nullable(),
  original_invoice_id: z.string().uuid(),
  original_invoice_number: z.string().nullable(),
  billing_party_id: z.string().uuid(),
  billing_party_name: z.string(),
  credit_date: z.string(),
  reason: z.string(),
  total_pkr: z.number(),
  status: CreditNoteStatus,
  book_type: BookType,
  journal_entry_id: z.string().uuid().nullable(),
  journal_entry_number: z.string().nullable(),
  notes: z.string().nullable(),
  created_at: z.string(),
  created_by_name: z.string(),
  line_items: z.array(CreditNoteLineItemResponse),
});
export type CreditNoteResponseType = z.infer<typeof CreditNoteResponse>;

export const CreditNoteListQuery = z.object({
  invoice_id: z.string().uuid().optional(),
  billing_party_id: z.string().uuid().optional(),
  status: CreditNoteStatus.optional(),
  date_from: dateOnly.optional(),
  date_to: dateOnly.optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});
export type CreditNoteListQueryType = z.infer<typeof CreditNoteListQuery>;

// ============================================================
// Bad Debt Write-Off
// ============================================================

export const BadDebtWriteOffRequest = z.object({
  invoice_id: z.string().uuid(),
  reason: z.string().min(1),
  write_off_date: dateOnly,
  notes: z.string().optional(),
});
export type BadDebtWriteOffRequestType = z.infer<typeof BadDebtWriteOffRequest>;
