import type { PrismaClient } from '@coldchain/db';
import { round2 } from '@coldchain/shared';
import { parseDateOnly, startOfToday } from '../helpers/money';
import { accountBalances } from '../../accounting/ledger';

export interface CashExceptionsFilters {
  as_of_date?: string;
}

/**
 * Every account the chart flags as cash (`is_cash_equivalent`), with its balance
 * as of a date, flagging any that have gone negative.
 *
 * Replaces the P1-6 posting-time guard (docs/20_audit_backlog.md), which was
 * built, found no overdraft facility is modelled anywhere in this system, and
 * reverted: a hard 422 on the bank account would reject a real payment the
 * moment the ledger's recorded balance fell behind the facility's actual bank
 * balance — pushing the operator to NOT record a transaction that genuinely
 * happened. This report surfaces the same control failure without ever
 * blocking a posting.
 *
 * Cash is the chart flag, not "the children of the Cash & Bank header" — that
 * header also holds Cheques in Hand, which can still bounce, and an owner's
 * second bank account is cash wherever it was opened (docs/25 L-20). The balance
 * is the drawer's: both books, since physical cash is one pile of money.
 */
export async function getCashExceptions(prisma: PrismaClient, facilityId: string, filters: CashExceptionsFilters) {
  const asOf = parseDateOnly(filters.as_of_date) ?? startOfToday();
  const asOfIso = asOf.toISOString().slice(0, 10);

  const accounts = await prisma.chartOfAccounts.findMany({
    where: { facilityId, isCashEquivalent: true },
    orderBy: { accountCode: 'asc' },
    select: { accountCode: true, accountName: true, isActive: true },
  });
  const codes = accounts.map((a) => a.accountCode);
  const [pacci, katchi] = await Promise.all([
    accountBalances(prisma, { facilityId, book: 'PACCI', to: asOf, accounts: codes }),
    accountBalances(prisma, { facilityId, book: 'KATCHI', to: asOf, accounts: codes }),
  ]);

  const rows = accounts.map((a) => {
    // Debit-normal: a cash account's balance is what it has been debited less
    // what it has been credited, in either book.
    const net = (sums: typeof pacci) => {
      const s = sums.get(a.accountCode);
      return s ? s.debit - s.credit : 0;
    };
    const balance_pkr = round2(net(pacci) + net(katchi));
    return {
      account_code: a.accountCode,
      account_name: a.accountName,
      is_active: a.isActive,
      balance_pkr,
      is_negative: balance_pkr < 0,
    };
  });

  return { as_of_date: asOfIso, rows, has_exceptions: rows.some((r) => r.is_negative) };
}
