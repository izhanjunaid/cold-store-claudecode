import type { Prisma } from '@coldchain/db';

export function formatPeshgiNumber(date: Date, next: number): string {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const seq = String(next).padStart(4, '0');
  return `PSH-${yyyy}${mm}-${seq}`;
}

export function peshgiNumberPrefix(date: Date): string {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `PSH-${yyyy}${mm}-`;
}

export async function generatePeshgiNumber(
  tx: Prisma.TransactionClient,
  facilityId: string,
  date: Date,
): Promise<string> {
  const prefix = peshgiNumberPrefix(date);
  const lockKey = `${facilityId}:${prefix}`;

  await tx.$queryRawUnsafe<unknown[]>(
    `SELECT 1 AS _lock WHERE pg_advisory_xact_lock(hashtext($1)) IS NOT NULL OR TRUE`,
    lockKey,
  );

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
