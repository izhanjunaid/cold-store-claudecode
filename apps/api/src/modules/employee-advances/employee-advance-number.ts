import type { Prisma } from '@coldchain/db';
import { advisoryXactLock } from '../../common/advisory-lock';

/**
 * Format: ADV-YYMMDD-NNN. Sequence resets per facility per day, mirroring peshgi's
 * loan-number scheme (L-YYMMDD-NNN).
 */
export function formatEmployeeAdvanceNumber(date: Date, next: number): string {
  const yy = String(date.getFullYear() % 100).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const seq = String(next).padStart(3, '0');
  return `ADV-${yy}${mm}${dd}-${seq}`;
}

export function employeeAdvanceNumberPrefix(date: Date): string {
  const yy = String(date.getFullYear() % 100).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `ADV-${yy}${mm}${dd}-`;
}

export async function generateEmployeeAdvanceNumber(
  tx: Prisma.TransactionClient,
  facilityId: string,
  date: Date,
): Promise<string> {
  const prefix = employeeAdvanceNumberPrefix(date);
  const lockKey = `${facilityId}:${prefix}`;

  await advisoryXactLock(tx, lockKey);

  const rows = await tx.$queryRawUnsafe<{ next: number | bigint }[]>(
    `SELECT COALESCE(MAX(CAST(split_part(advance_number, '-', 3) AS INT)), 0) + 1 AS next
     FROM employee_advances
     WHERE facility_id = $1::uuid AND advance_number LIKE $2`,
    facilityId,
    `${prefix}%`,
  );
  const next = Number(rows[0]?.next ?? 1);
  return formatEmployeeAdvanceNumber(date, next);
}
