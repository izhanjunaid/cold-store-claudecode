import type { PrismaClient } from '@coldchain/db';
import { parseDateOnly, round2, startOfToday } from '../helpers/money';

export interface CashExceptionsFilters {
  as_of_date?: string;
}

/**
 * Every cash-class account (the children of header 1000) with its balance as
 * of a date, flagging any that have gone negative.
 *
 * Replaces the P1-6 posting-time guard (docs/20_audit_backlog.md), which was
 * built, found no overdraft facility is modelled anywhere in this system, and
 * reverted: a hard 422 on 1020 (bank) would reject a real payment the moment
 * the ledger's recorded balance fell behind the facility's actual bank
 * balance — e.g. because opening balances were never entered — pushing the
 * operator to NOT record a transaction that genuinely happened. An unrecorded
 * transaction is worse than a visible negative balance. This report surfaces
 * the same control failure (an unrecorded deposit, or a payment that never
 * happened) without ever blocking a posting.
 *
 * The cash set is derived from the chart, not a hardcoded code list — the
 * same rule the web's isCashOrBank() uses — so a facility that adds a fourth
 * cash-class account under 1000 is covered without a code change here.
 */
export async function getCashExceptions(
  prisma: PrismaClient,
  facilityId: string,
  filters: CashExceptionsFilters,
) {
  const asOf = parseDateOnly(filters.as_of_date) ?? startOfToday();
  const asOfIso = asOf.toISOString().slice(0, 10);

  const accounts = await prisma.chartOfAccounts.findMany({
    where: { facilityId, parentAccountCode: '1000', accountType: 'DETAIL' },
    orderBy: { accountCode: 'asc' },
    select: { accountCode: true, accountName: true, isActive: true },
  });
  if (accounts.length === 0) return { as_of_date: asOfIso, rows: [], has_exceptions: false };

  // Same where-clause shape as coa.service.ts's balance check (the account
  // never has more than a handful of children, so N small aggregates over
  // one groupBy costs nothing and reuses an already-proven query pattern).
  const rows = await Promise.all(
    accounts.map(async (a) => {
      const agg = await prisma.journalEntryLine.aggregate({
        where: {
          facilityId,
          accountCode: a.accountCode,
          journalEntry: { facilityId, postingStatus: 'POSTED', entryDate: { lte: asOf } },
        },
        _sum: { debitAmount: true, creditAmount: true },
      });
      // Debit-normal: a cash account's balance is what it's been debited
      // minus what it's been credited.
      const balance_pkr = round2(Number(agg._sum.debitAmount ?? 0) - Number(agg._sum.creditAmount ?? 0));
      return {
        account_code: a.accountCode,
        account_name: a.accountName,
        is_active: a.isActive,
        balance_pkr,
        is_negative: balance_pkr < 0,
      };
    }),
  );

  return {
    as_of_date: asOfIso,
    rows,
    has_exceptions: rows.some((r) => r.is_negative),
  };
}
