import type { JournalEntryDraft } from './types';

/**
 * Derived equity accounts. Retained earnings and the current-year result are
 * computed by the statements, never posted, so neither may be the equity side
 * of an owner movement.
 */
export const DERIVED_EQUITY_ACCOUNTS = ['3020', '3030'] as const;

export type OwnerEquityDirection = 'CAPITAL_IN' | 'DRAWING';

type Input = {
  movementDate: Date;
  amountPkr: number;
  direction: OwnerEquityDirection;
  /** The owner's own capital or drawings account. */
  equityAccountCode: string;
  /** Where the money actually moves: 1010 / 1020 / 1030. */
  cashAccountCode: string;
  bookType: 'PACCI' | 'KATCHI';
  /** No source document, so the acting user stands in — as JE-27 does. */
  userId: string;
  note?: string | null;
};

/**
 * JE-30: an owner puts money into the business, or takes money out.
 *
 *   CAPITAL_IN   DR  cash/bank            CR  owner's capital account
 *   DRAWING      DR  owner's drawings     CR  cash/bank
 *
 * **An owner's pay is not an expense, however regular it is.** A member of an
 * association of persons cannot be an employee of it, so what they take is an
 * appropriation of profit rather than a cost of earning it — the monthly amount
 * and any extra taken out of profits are the same thing in accounting terms and
 * differ only in the note. Income Tax Ordinance 2001 s.21(j) is explicit rather
 * than a matter of judgement: no deduction is allowed for "any profit on debt,
 * brokerage, commission, salary or other remuneration paid by an association of
 * persons to a member of the association".
 *
 * This template exists because the alternative was worse than inconvenient.
 * Payroll posts every line to 6010 Salaries — Management & Office
 * (je-15-monthly-payroll.ts) with no owner concept in EmployeeType, and expense
 * vouchers accept only EXPENSE and COST_OF_SERVICE accounts. So the only
 * correct way to record an owner's withdrawal was a hand-written journal entry
 * — friction that pushes a non-accountant straight into payroll, where the
 * entry understates profit, every P&L margin, and taxable income at once.
 *
 * The equity side is the owner's own account. With more than one owner each has
 * their own, which is what makes a per-owner column possible on the statement of
 * changes in equity (IFRS for SMEs 4.13).
 */
export function buildJE30OwnerEquity(input: Input): JournalEntryDraft {
  const amount = Math.round(input.amountPkr * 100) / 100;
  const note = input.note?.trim();
  const isDrawing = input.direction === 'DRAWING';

  const debitCode = isDrawing ? input.equityAccountCode : input.cashAccountCode;
  const creditCode = isDrawing ? input.cashAccountCode : input.equityAccountCode;
  const what = isDrawing ? 'Owner drawing' : 'Owner capital introduced';

  return {
    entryType: 'ADJUSTMENT',
    bookType: input.bookType,
    sourceTable: 'owner_equity',
    sourceId: input.userId,
    entryDate: input.movementDate,
    description: `${what} — ${input.equityAccountCode} Rs. ${amount.toLocaleString()}${note ? ` — ${note}` : ''}`,
    lines: [
      {
        accountCode: debitCode,
        debitAmount: amount,
        creditAmount: 0,
        description: note ?? what,
      },
      {
        accountCode: creditCode,
        debitAmount: 0,
        creditAmount: amount,
        description: note ?? what,
      },
    ],
  };
}
