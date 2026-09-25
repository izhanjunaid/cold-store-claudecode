/**
 * Where a journal entry comes from — the `source_table` it records — and whether a
 * person may reverse it directly from the journal.
 *
 * Only entries with no document behind them are reversed from the journal. Anything a
 * document posted is corrected through that document (void the invoice, cancel the
 * credit note, reverse the payroll run), because reversing the entry behind the
 * document's back would leave the document saying one thing and the ledger another.
 * The API and the web both read this list; they used to keep separate whitelists, and
 * the web's had already drifted (docs/25 L-09).
 */
export const JOURNAL_SOURCES = {
  manual: { label: 'Manual journal', userReversible: true },
  opening_balances: { label: 'Opening balances', userReversible: true },
  // Posted before cash transfers and owner movements became documents (docs/25 C-44):
  // no document exists to void, so the journal is where they are corrected.
  cash_transfer: { label: 'Cash transfer (legacy)', userReversible: true },
  owner_equity: { label: 'Owner capital / drawings (legacy)', userReversible: true },
  // Reversal mirrors posted before reverseInTransaction inherited the original's source.
  journal_entries: { label: 'Reversal', userReversible: false },

  invoices: { label: 'Invoice', userReversible: false },
  invoice_surcharge: { label: 'Late-payment surcharge (legacy)', userReversible: false },
  payments: { label: 'Receipt', userReversible: false },
  credit_notes: { label: 'Credit note', userReversible: false },
  party_loans: { label: 'Peshgi loan', userReversible: false },
  party_loan_repayments: { label: 'Peshgi repayment', userReversible: false },
  revenue_accrual: { label: 'Storage revenue accrual', userReversible: false },
  gst_settlement: { label: 'GST settlement', userReversible: false },
  withholding_remittance: { label: 'Withholding remittance (legacy)', userReversible: false },
  payroll_runs: { label: 'Payroll run', userReversible: false },
  employee_advances: { label: 'Employee advance', userReversible: false },
  fixed_assets: { label: 'Fixed asset', userReversible: false },
  expense_vouchers: { label: 'Expense voucher (legacy)', userReversible: false },
  bills: { label: 'Supplier bill', userReversible: false },
  supplier_payments: { label: 'Supplier payment', userReversible: false },
  tax_remittances: { label: 'Tax remittance', userReversible: false },
  cash_transfers: { label: 'Cash transfer', userReversible: false },
  owner_equity_movements: { label: 'Owner capital / drawings', userReversible: false },
} as const;

export type JournalSource = keyof typeof JOURNAL_SOURCES;

export function isUserReversibleSource(sourceTable: string): boolean {
  return (JOURNAL_SOURCES as Record<string, { userReversible: boolean }>)[sourceTable]?.userReversible ?? false;
}

export function journalSourceLabel(sourceTable: string): string {
  return (JOURNAL_SOURCES as Record<string, { label: string }>)[sourceTable]?.label ?? sourceTable;
}
