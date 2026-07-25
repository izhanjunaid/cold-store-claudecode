import type { Prisma } from '@coldchain/db';
import { advisoryXactLock } from '../../common/advisory-lock';

/**
 * Format: L-YYMMDD-NNN (per docs/08_data_model.md §30).
 * Sequence resets per facility per day.
 */
export function formatPeshgiNumber(date: Date, next: number): string {
  const yy = String(date.getFullYear() % 100).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const seq = String(next).padStart(3, '0');
  return `L-${yy}${mm}${dd}-${seq}`;
}

export function peshgiNumberPrefix(date: Date): string {
  const yy = String(date.getFullYear() % 100).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `L-${yy}${mm}${dd}-`;
}

export async function generatePeshgiNumber(
  tx: Prisma.TransactionClient,
  facilityId: string,
  date: Date,
): Promise<string> {
  const prefix = peshgiNumberPrefix(date);
  const lockKey = `${facilityId}:${prefix}`;

  await advisoryXactLock(tx, lockKey);

  const rows = await tx.$queryRawUnsafe<{ next: number | bigint }[]>(
    `SELECT COALESCE(MAX(CAST(split_part(loan_number, '-', 3) AS INT)), 0) + 1 AS next
     FROM party_loans
     WHERE facility_id = $1::uuid AND loan_number LIKE $2`,
    facilityId,
    `${prefix}%`,
  );
  const next = Number(rows[0]?.next ?? 1);
  return formatPeshgiNumber(date, next);
}
