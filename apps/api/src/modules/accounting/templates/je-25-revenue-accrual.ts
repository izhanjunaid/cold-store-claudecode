import type { JournalEntryDraft, JournalEntryLineDraft } from './types';
import { SYSTEM_ACCOUNTS, round2 } from '@coldchain/shared';

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
 * JE-25: accrue storage revenue earned but not yet billed, at a month-end.
 *
 *   DR  1250 Accrued Storage Revenue (Unbilled)   per lot
 *     CR  storage revenue — per lot's account
 *
 * The amount is cumulative from each lot's billing start, and the entry is
 * reversed the next day (RevenueAccrualService posts both together), so each
 * month keeps exactly what it earned and the invoice that eventually bills the
 * storage books the revenue.
 *
 * 1250 sits under Other Current Assets, never under Trade Receivables — nobody
 * owes this yet, so it must not reach AR aging or the receivable controls.
 */
export function buildJE25RevenueAccrual(input: Input): JournalEntryDraft {
  // One 1250 line per lot, so the accrued balance can always be broken down by lot.
  const debits: JournalEntryLineDraft[] = input.shares
    .filter((s) => round2(s.amountPkr) > 0)
    .map((s) => ({
      accountCode: SYSTEM_ACCOUNTS.ACCRUED_STORAGE_REVENUE,
      debitAmount: round2(s.amountPkr),
      creditAmount: 0,
      lotId: s.lotId,
      description: `Storage earned, not yet billed — lot ${s.lotNumber}`,
    }));

  // One credit per revenue account, from the same per-lot rounded figures, so both
  // sides agree to the paisa (the deferred balance trigger allows no tolerance).
  const byAccount = new Map<string, number>();
  for (const s of input.shares) {
    byAccount.set(s.revenueAccountCode, (byAccount.get(s.revenueAccountCode) ?? 0) + round2(s.amountPkr));
  }
  const credits: JournalEntryLineDraft[] = [...byAccount.entries()]
    .map(([accountCode, amount]) => ({ accountCode, amount: round2(amount) }))
    .filter((c) => c.amount > 0)
    .sort((a, b) => a.accountCode.localeCompare(b.accountCode))
    .map((c) => ({ accountCode: c.accountCode, debitAmount: 0, creditAmount: c.amount, description: 'Storage earned, not yet billed' }));

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
