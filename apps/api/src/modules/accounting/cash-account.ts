import type { Prisma } from '@coldchain/db';
import { Errors } from '../../common/errors';

/**
 * The one rule for money leaving or arriving in cash (docs/25 §2 invariant 2): the
 * account must be an active DETAIL account flagged `is_cash_equivalent`. An owner's
 * second bank account qualifies; cheques in hand (1025) and any header do not.
 */
export async function assertCashAccount(tx: Prisma.TransactionClient, facilityId: string, code: string) {
  const account = await tx.chartOfAccounts.findUnique({
    where: { facilityId_accountCode: { facilityId, accountCode: code } },
    select: { accountType: true, isActive: true, isCashEquivalent: true },
  });
  if (!account?.isActive || account.accountType !== 'DETAIL' || !account.isCashEquivalent) {
    throw Errors.NOT_A_CASH_ACCOUNT(code);
  }
}
