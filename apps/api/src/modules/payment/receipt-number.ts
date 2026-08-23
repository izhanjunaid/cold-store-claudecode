import type { Prisma } from '@coldchain/db';
import { advisoryXactLock } from '../../common/advisory-lock';

// UTC throughout, matching every other document-number generator here.
export function formatReceiptNumber(date: Date, next: number): string {
  const yyyy = String(date.getUTCFullYear());
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `RCP-${yyyy}${mm}-${String(next).padStart(4, '0')}`;
}

export function receiptNumberPrefix(date: Date): string {
  const yyyy = String(date.getUTCFullYear());
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `RCP-${yyyy}${mm}-`;
}

/**
 * Next receipt number for the facility and month.
 *
 * The advisory lock is the real guard — MAX+1 without it hands the same number
 * to two concurrent receipts. The unique index on (facility_id,
 * receipt_number) is the backstop, not the mechanism. Payments recorded before
 * this existed carry no number, and NULLs do not collide, so they neither
 * block a number nor consume one.
 */
export async function generateReceiptNumber(
  tx: Prisma.TransactionClient,
  facilityId: string,
  date: Date,
): Promise<string> {
  const prefix = receiptNumberPrefix(date);
  await advisoryXactLock(tx, `${facilityId}:${prefix}`);

  const rows = await tx.$queryRawUnsafe<{ next: number | bigint }[]>(
    `SELECT COALESCE(MAX(CAST(split_part(receipt_number, '-', 3) AS INT)), 0) + 1 AS next
     FROM payments
     WHERE facility_id = $1::uuid AND receipt_number LIKE $2`,
    facilityId,
    `${prefix}%`,
  );
  return formatReceiptNumber(date, Number(rows[0]?.next ?? 1));
}
