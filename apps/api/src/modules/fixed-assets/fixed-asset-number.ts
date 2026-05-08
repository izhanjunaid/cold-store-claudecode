import type { Prisma } from '@coldchain/db';

export function formatFixedAssetNumber(year: number, next: number): string {
  const yyyy = String(year);
  const seq = String(next).padStart(4, '0');
  return `FA-${yyyy}-${seq}`;
}

export function fixedAssetNumberPrefix(year: number): string {
  return `FA-${year}-`;
}

/**
 * Generate the next FA-YYYY-NNNN number for the facility, scoped to the year of `purchaseDate`.
 * Uses pg_advisory_xact_lock keyed on `${facilityId}:${prefix}` to serialise concurrent inserts.
 */
export async function generateFixedAssetNumber(
  tx: Prisma.TransactionClient,
  facilityId: string,
  purchaseDate: Date,
): Promise<string> {
  const year = purchaseDate.getFullYear();
  const prefix = fixedAssetNumberPrefix(year);
  const lockKey = `${facilityId}:${prefix}`;

  await tx.$queryRawUnsafe<unknown[]>(
    `SELECT 1 AS _lock WHERE pg_advisory_xact_lock(hashtext($1)) IS NOT NULL OR TRUE`,
    lockKey,
  );

  const rows = await tx.$queryRawUnsafe<{ next: number | bigint }[]>(
    `SELECT COALESCE(MAX(CAST(split_part(asset_number, '-', 3) AS INT)), 0) + 1 AS next
     FROM fixed_assets
     WHERE facility_id = $1::uuid AND asset_number LIKE $2`,
    facilityId,
    `${prefix}%`,
  );
  const next = Number(rows[0]?.next ?? 1);
  return formatFixedAssetNumber(year, next);
}
