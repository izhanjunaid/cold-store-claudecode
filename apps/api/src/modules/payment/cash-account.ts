import type { Prisma, PrismaClient } from '@coldchain/db';
import { Errors } from '../../common/errors';

/**
 * Money is paid from, or received into, an account the chart marks cash-equivalent
 * — cash, a bank or a wallet, including one the owner added — never a list of
 * codes, which knew nothing of a second bank account (docs/25 L-20, R-19, R-33).
 */
export async function assertCashEquivalent(
  db: PrismaClient | Prisma.TransactionClient,
  facilityId: string,
  accountCode: string,
  field: string,
): Promise<void> {
  const account = await db.chartOfAccounts.findFirst({
    where: { facilityId, accountCode },
    select: { isCashEquivalent: true, isActive: true, accountName: true },
  });
  if (!account || !account.isActive || !account.isCashEquivalent) {
    throw Errors.VALIDATION_ERROR(
      `${accountCode}${account ? ` ${account.accountName}` : ''} is not an active cash, bank or wallet account`,
      field,
    );
  }
}
