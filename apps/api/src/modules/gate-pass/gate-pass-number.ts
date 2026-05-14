import type { Prisma } from '@coldchain/db';

export function formatGatePassNumber(date: Date, next: number): string {
  const yy = String(date.getFullYear() % 100).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const seq = String(next).padStart(4, '0');
  return `GP-${yy}${mm}${dd}-${seq}`;
}

export function gatePassNumberPrefix(date: Date): string {
  const yy = String(date.getFullYear() % 100).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `GP-${yy}${mm}${dd}-`;
}

export async function generateGatePassNumber(
  tx: Prisma.TransactionClient,
  facilityId: string,
  date: Date,
): Promise<string> {
  const prefix = gatePassNumberPrefix(date);
  const lockKey = `${facilityId}:${prefix}`;

  await tx.$queryRawUnsafe<unknown[]>(
    `SELECT 1 AS _lock WHERE pg_advisory_xact_lock(hashtext($1)) IS NOT NULL OR TRUE`,
    lockKey,
  );

  const rows = await tx.$queryRawUnsafe<{ next: number | bigint }[]>(
    `SELECT COALESCE(MAX(CAST(split_part(pass_number, '-', 3) AS INT)), 0) + 1 AS next
     FROM gate_passes
     WHERE facility_id = $1::uuid AND pass_number LIKE $2`,
    facilityId,
    `${prefix}%`,
  );
  const next = Number(rows[0]?.next ?? 1);
  return formatGatePassNumber(date, next);
}
