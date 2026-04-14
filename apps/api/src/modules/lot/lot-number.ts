import type { Prisma } from '@coldchain/db';

/**
 * Format a lot number from a date + sequence suffix.
 * Format: `LOT-YYMMDD-NNNN` (NNNN zero-padded to 4 digits).
 */
export function formatLotNumber(date: Date, next: number): string {
  const yy = String(date.getFullYear() % 100).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const seq = String(next).padStart(4, '0');
  return `LOT-${yy}${mm}${dd}-${seq}`;
}

/** Lot-number prefix for a given date, e.g. `LOT-260410-`. */
export function lotNumberPrefix(date: Date): string {
  const yy = String(date.getFullYear() % 100).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `LOT-${yy}${mm}${dd}-`;
}

/**
 * Concurrency-safe lot number generation using a PostgreSQL advisory
 * lock keyed on `hashtext(facilityId || prefix)`. This serializes
 * concurrent inserts within the same transaction connection, while the
 * unique index `(facility_id, lot_number)` acts as a final backstop.
 */
export async function generateLotNumber(
  tx: Prisma.TransactionClient,
  facilityId: string,
  date: Date,
): Promise<string> {
  const prefix = lotNumberPrefix(date);
  const lockKey = `${facilityId}:${prefix}`;

  // Acquire a transaction-scoped advisory lock so concurrent callers
  // serialize on the same (facility, date) pair.
  // Wrap in a CTE returning 1 so Prisma can deserialize (void is unsupported).
  await tx.$queryRawUnsafe<unknown[]>(
    `SELECT 1 AS _lock WHERE pg_advisory_xact_lock(hashtext($1)) IS NOT NULL OR TRUE`,
    lockKey,
  );

  const rows = await tx.$queryRawUnsafe<{ next: number | bigint }[]>(
    `SELECT COALESCE(MAX(CAST(split_part(lot_number, '-', 3) AS INT)), 0) + 1 AS next
     FROM lots
     WHERE facility_id = $1::uuid AND lot_number LIKE $2`,
    facilityId,
    `${prefix}%`,
  );
  const next = Number(rows[0]?.next ?? 1);
  return formatLotNumber(date, next);
}
