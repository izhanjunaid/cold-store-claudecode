import type { Prisma } from '@coldchain/db';
import { advisoryXactLock } from '../../common/advisory-lock';

// UTC throughout — see the note in invoice-number.ts. phase/19 fixed this for
// journal-entry numbering; the expense and invoice generators were missed.
export function formatExpenseVoucherNumber(date: Date, next: number): string {
  const yyyy = String(date.getUTCFullYear());
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const seq = String(next).padStart(4, '0');
  return `EXP-${yyyy}${mm}-${seq}`;
}

export function expenseVoucherNumberPrefix(date: Date): string {
  const yyyy = String(date.getUTCFullYear());
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `EXP-${yyyy}${mm}-`;
}

export async function generateExpenseVoucherNumber(
  tx: Prisma.TransactionClient,
  facilityId: string,
  date: Date,
): Promise<string> {
  const prefix = expenseVoucherNumberPrefix(date);
  const lockKey = `${facilityId}:${prefix}`;

  await advisoryXactLock(tx, lockKey);

  const rows = await tx.$queryRawUnsafe<{ next: number | bigint }[]>(
    `SELECT COALESCE(MAX(CAST(split_part(voucher_number, '-', 3) AS INT)), 0) + 1 AS next
     FROM expense_vouchers
     WHERE facility_id = $1::uuid AND voucher_number LIKE $2`,
    facilityId,
    `${prefix}%`,
  );
  const next = Number(rows[0]?.next ?? 1);
  return formatExpenseVoucherNumber(date, next);
}
