import { round2 } from '@coldchain/shared';
import type { JournalEntryDraft } from './types';

export type OwnerEquityDirection = 'CAPITAL_IN' | 'DRAWING';

type Input = {
  /** The owner_equity_movements row this entry records — its source document. */
  movementId: string;
  movementDate: Date;
  amountPkr: number;
  direction: OwnerEquityDirection;
  partnerName: string;
  /** Derived by the caller from the partner and the direction — never chosen separately. */
  equityAccountCode: string;
  /** Any account the chart flags as cash. */
  cashAccountCode: string;
  bookType: 'PACCI' | 'KATCHI';
  note?: string | null;
};

/**
 * JE-30: an owner puts money into the business, or takes money out.
 *
 *   CAPITAL_IN   DR  cash/bank              CR  the owner's capital account
 *   DRAWING      DR  the owner's drawings   CR  cash/bank
 *
 * **An owner's pay is not an expense, however regular it is.** A member of an
 * association of persons cannot be its employee, so what they take is an
 * appropriation of profit, not a cost of earning it. Income Tax Ordinance 2001
 * s.21(j) disallows "any profit on debt, brokerage, commission, salary or other
 * remuneration paid by an association of persons to a member of the association".
 * Payroll refuses to employ a current owner (by CNIC) for the same reason.
 */
export function buildJE30OwnerEquity(input: Input): JournalEntryDraft {
  const amount = round2(input.amountPkr);
  const note = input.note?.trim();
  const isDrawing = input.direction === 'DRAWING';
  const what = isDrawing ? `Drawing — ${input.partnerName}` : `Capital introduced — ${input.partnerName}`;

  return {
    entryType: 'OWNER_EQUITY',
    bookType: input.bookType,
    sourceTable: 'owner_equity_movements',
    sourceId: input.movementId,
    entryDate: input.movementDate,
    description: `${what}${note ? ` — ${note}` : ''}`,
    lines: [
      {
        accountCode: isDrawing ? input.equityAccountCode : input.cashAccountCode,
        debitAmount: amount,
        creditAmount: 0,
        description: note || what,
      },
      {
        accountCode: isDrawing ? input.cashAccountCode : input.equityAccountCode,
        debitAmount: 0,
        creditAmount: amount,
        description: note || what,
      },
    ],
  };
}
