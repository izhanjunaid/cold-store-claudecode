import type { JournalEntryDraft, JournalEntryLineDraft } from './types';

export const ACCOUNT_ACCRUED_STORAGE_REVENUE = '1250';

export type AccrualLotShare = {
  lotId: string;
  lotNumber: string;
  revenueAccountCode: string;
  amountPkr: number;
};

type Input = {
  periodEnd: Date;
  bookType: 'PACCI' | 'KATCHI';
  facilityId: string;
  shares: AccrualLotShare[];
};

/**
 * JE-25: accrue storage revenue earned but not yet billed.
 *
 *   DR  1250 Accrued Storage Revenue (Unbilled)   total
 *     CR  4010–4050 Storage Revenue — by commodity
 *
 * Storage is a service rendered over time; revenue is otherwise recognised
 * only when the invoice is finalised, which happens at withdrawal. That puts a
 * whole season's revenue into one month and leaves every period end showing
 * nothing for lots still in storage (docs/16, F-16).
 *
 * The amount is **cumulative from the billing period start**, not the month's
 * own slice, and the whole prior accrual is reversed at the start of the next
 * period. That is what makes the pattern work: a periodic accrual plus a
 * reversal nets to zero in every intermediate month and reproduces the defect
 * it was meant to fix.
 *
 * 1250 sits under 1200 Other Current Assets, never under 1100 Trade
 * Receivables — nobody owes this yet, so it must not reach AR ageing or the
 * receivable control accounts.
 */
export function buildJE25RevenueAccrual(input: Input): JournalEntryDraft {
  const round = (n: number) => Math.round(n * 100) / 100;

  // One 1250 debit line per lot, tagged with lotId. A single lumped debit
  // would balance just as well, but then the accrued balance could never be
  // attributed back to the lots that make it up — and 1250 is precisely the
  // account an accountant will ask to see broken down.
  const debits: JournalEntryLineDraft[] = input.shares
    .filter((s) => round(s.amountPkr) > 0)
    .map((s) => ({
      accountCode: ACCOUNT_ACCRUED_STORAGE_REVENUE,
      debitAmount: round(s.amountPkr),
      creditAmount: 0,
      lotId: s.lotId,
      description: `Storage earned, not yet billed — lot ${s.lotNumber}`,
    }));

  // One credit line per revenue account, so the P&L still splits by commodity.
  const byAccount = new Map<string, number>();
  for (const s of input.shares) {
    byAccount.set(s.revenueAccountCode, (byAccount.get(s.revenueAccountCode) ?? 0) + round(s.amountPkr));
  }

  const credits: JournalEntryLineDraft[] = [...byAccount.entries()]
    .map(([accountCode, amount]) => ({ accountCode, amount: round(amount) }))
    .filter((c) => c.amount > 0)
    .sort((a, b) => a.accountCode.localeCompare(b.accountCode))
    .map((c) => ({
      accountCode: c.accountCode,
      debitAmount: 0,
      creditAmount: c.amount,
      description: 'Storage earned, not yet billed',
    }));

  // Both sides are built from the same per-lot rounded figures, so they agree
  // to the paisa. Rounding each side independently from raw totals can leave
  // the entry a paisa out, and the deferred balance trigger rejects that at
  // COMMIT with no tolerance at all.
  return {
    entryType: 'ACCRUAL',
    bookType: input.bookType,
    sourceTable: 'revenue_accrual',
    sourceId: input.facilityId,
    entryDate: input.periodEnd,
    description: `Accrued storage revenue — ${debits.length} lot(s) in storage`,
    lines: [...debits, ...credits],
  };
}

/**
 * The reversal of a prior accrual, posted as its own fresh entry at the start
 * of the next period.
 *
 * Deliberately not JournalEntryService.reverse(): that whitelists only
 * `manual` and `opening_balances`, and — more importantly — it flips the
 * original to postingStatus REVERSED. Every statement and GL query filters on
 * POSTED, so marking the original REVERSED would delete the accrual from the
 * very period it was recognising. October's revenue would vanish the moment
 * November's reversal ran.
 *
 * Nothing here is a correction. Both entries are ordinary postings, told apart
 * by entryType: ACCRUAL for the accrual, ADJUSTMENT for its reversal.
 */
export function buildJE25Reversal(input: {
  facilityId: string;
  bookType: 'PACCI' | 'KATCHI';
  reversalDate: Date;
  accruedEntryNumber: string;
  lines: { accountCode: string; debitAmount: number; creditAmount: number; lotId: string | null }[];
}): JournalEntryDraft {
  return {
    entryType: 'ADJUSTMENT',
    bookType: input.bookType,
    sourceTable: 'revenue_accrual',
    sourceId: input.facilityId,
    entryDate: input.reversalDate,
    description: `Reversal of accrued storage revenue ${input.accruedEntryNumber}`,
    lines: input.lines.map((l) => ({
      accountCode: l.accountCode,
      // Sides swapped; lot attribution carried through so the reversal nets
      // against the accrual lot by lot, not just in total.
      debitAmount: l.creditAmount,
      creditAmount: l.debitAmount,
      lotId: l.lotId ?? undefined,
      description: 'Reversal of prior period accrual',
    })),
  };
}
