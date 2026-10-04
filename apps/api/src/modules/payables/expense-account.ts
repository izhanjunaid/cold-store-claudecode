import type { Prisma, PrismaClient } from '@coldchain/db';
import { EXPENSE_ACCOUNT_CLASSES } from '@coldchain/shared';
import { Errors } from '../../common/errors';

/**
 * The one rule for where a cost may be booked (docs/25 C-05): an active DETAIL account
 * of an expense class that a person may post to. Payroll, depreciation, bad-debt and
 * disposal accounts are each moved by their own flow (allow_manual_posting false), so
 * a bill against one would double-count it; a header is never postable at all.
 */
export async function assertExpenseAccount(
  db: PrismaClient | Prisma.TransactionClient,
  facilityId: string,
  code: string,
  field: string,
): Promise<void> {
  const account = await db.chartOfAccounts.findUnique({
    where: { facilityId_accountCode: { facilityId, accountCode: code } },
    select: { accountName: true, accountClass: true, accountType: true, isActive: true, allowManualPosting: true },
  });
  if (
    !account?.isActive ||
    account.accountType !== 'DETAIL' ||
    !EXPENSE_ACCOUNT_CLASSES.includes(account.accountClass) ||
    !account.allowManualPosting
  ) {
    throw Errors.VALIDATION_ERROR(
      `${code}${account ? ` ${account.accountName}` : ''} is not an expense account a cost can be booked to`,
      field,
    );
  }
}
