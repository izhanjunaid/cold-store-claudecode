import type { Prisma } from '@coldchain/db';

export function formatPayrollRunNumber(year: number, month: number, next: number): string {
  const yyyy = String(year);
  const mm = String(month).padStart(2, '0');
  const seq = String(next).padStart(3, '0');
  return `PAY-${yyyy}${mm}-${seq}`;
}

export function payrollRunNumberPrefix(year: number, month: number): string {
  return `PAY-${year}${String(month).padStart(2, '0')}-`;
}

export async function generatePayrollRunNumber(
  tx: Prisma.TransactionClient,
  facilityId: string,
  year: number,
  month: number,
): Promise<string> {
  const prefix = payrollRunNumberPrefix(year, month);
  const lockKey = `${facilityId}:${prefix}`;

  await tx.$queryRawUnsafe<unknown[]>(
    `SELECT 1 AS _lock WHERE pg_advisory_xact_lock(hashtext($1)) IS NOT NULL OR TRUE`,
    lockKey,
  );

  const rows = await tx.$queryRawUnsafe<{ next: number | bigint }[]>(
    `SELECT COALESCE(MAX(CAST(split_part(run_number, '-', 3) AS INT)), 0) + 1 AS next
     FROM payroll_runs
     WHERE facility_id = $1::uuid AND run_number LIKE $2`,
    facilityId,
    `${prefix}%`,
  );
  const next = Number(rows[0]?.next ?? 1);
  return formatPayrollRunNumber(year, month, next);
}
