import type { Prisma, PrismaClient } from '@coldchain/db';
import { Errors } from '../../common/errors';

/**
 * The one rule for money leaving or arriving in cash (docs/25 §2 invariant 2): the
 * account must be an active DETAIL account flagged `is_cash_equivalent` — cash, a bank
 * or a wallet, including one the owner added. Cheques in hand (1025) and any header
 * do not qualify. `field` names the request field for the form to highlight.
 */
export async function assertCashAccount(
  db: PrismaClient | Prisma.TransactionClient,
  facilityId: string,
  code: string,
  field?: string,
) {
  const account = await db.chartOfAccounts.findUnique({
    where: { facilityId_accountCode: { facilityId, accountCode: code } },
    select: { accountName: true, accountType: true, isActive: true, isCashEquivalent: true },
  });
  if (!account?.isActive || account.accountType !== 'DETAIL' || !account.isCashEquivalent) {
    throw Errors.NOT_A_CASH_ACCOUNT(account ? `${code} ${account.accountName}` : code, field);
  }
}
