import type { Prisma } from '@coldchain/db';
import { businessDate, fromIsoDate } from '@coldchain/shared';
import { advisoryXactLock } from '../../common/advisory-lock';

// `date` is a calendar day as a UTC-midnight Date, so read it with the UTC getters.
export function formatGatePassNumber(date: Date, next: number): string {
  return `${gatePassNumberPrefix(date)}${String(next).padStart(4, '0')}`;
}

export function gatePassNumberPrefix(date: Date): string {
  const yy = String(date.getUTCFullYear() % 100).padStart(2, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `GP-${yy}${mm}${dd}-`;
}

/**
 * The next pass number for the facility day the instant `at` falls in. A pass is numbered
 * the moment the truck arrives, so the day is Lahore's: the container clock is UTC, and
 * between midnight and 05:00 in Lahore its date is still yesterday.
 */
export async function generateGatePassNumber(
  tx: Prisma.TransactionClient,
  facilityId: string,
  at: Date,
): Promise<string> {
  const day = fromIsoDate(businessDate(at));
  const prefix = gatePassNumberPrefix(day);
  const lockKey = `${facilityId}:${prefix}`;

  await advisoryXactLock(tx, lockKey);

  const rows = await tx.$queryRawUnsafe<{ next: number | bigint }[]>(
    `SELECT COALESCE(MAX(CAST(split_part(pass_number, '-', 3) AS INT)), 0) + 1 AS next
     FROM gate_passes
     WHERE facility_id = $1::uuid AND pass_number LIKE $2`,
    facilityId,
    `${prefix}%`,
  );
  const next = Number(rows[0]?.next ?? 1);
  return formatGatePassNumber(day, next);
}
